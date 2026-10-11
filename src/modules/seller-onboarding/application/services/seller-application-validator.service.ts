// Quy tắc kiểm tra hồ sơ Seller; mã địa chỉ được lưu theo master data GHN.

import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { Not, Repository } from 'typeorm';
import { SellerApplication } from '@/database/seller-onboarding/entities/seller-application.entity';
import { SellerApplicationStatus } from '@/database/seller-onboarding/enums/seller-application-status.enum';
import { SellerProfileType } from '@/database/shared/enums/seller-profile-type.enum';
import { PayoutAccountType } from '@/database/shared/enums/payout-account-type.enum';
import { toNullableString } from '@/modules/seller-onboarding/application/utils/seller-application-string.util';

const PERSON_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u;
const PHONE_PATTERN = /^(0|\+84)\d{9,10}$/;

interface ExternalCategoryResponse {
    id: string;
    isActive: boolean;
}

// Kiểm tra hợp lệ nghiệp vụ của bản nháp trước khi chuyển trạng thái sang chờ duyệt.
@Injectable()
export class SellerApplicationValidatorService {
    private readonly catalogBaseUrl: string;

    // Khởi tạo dependency và chỉ giữ URL của catalog vì địa chỉ GHN thuộc Shipping Service.
    constructor(
        @InjectRepository(SellerApplication)
        private readonly applicationRepository: Repository<SellerApplication>,
        private readonly http: HttpService,
        config: ConfigService,
    ) {
        this.catalogBaseUrl = config.get<string>(
            'CATALOG_SERVICE_URL',
            'http://localhost:3003',
        );
    }

    // Chỉ cho phép lưu nháp khi hồ sơ chưa được gửi hoặc đã quay về trạng thái nháp.
    assertDraftSaveAllowed(application: SellerApplication): void {
        if (application.status !== SellerApplicationStatus.DRAFT) {
            throw new ForbiddenException(
                'Chỉ hồ sơ đang ở trạng thái nháp mới có thể lưu nháp.',
            );
        }
    }

    // Khóa hồ sơ đang review hoặc đã duyệt để dữ liệu không đổi giữa các lần đối chiếu.
    assertSubmissionAllowed(application: SellerApplication): void {
        if (
            application.status === SellerApplicationStatus.PENDING_REVIEW ||
            application.status === SellerApplicationStatus.APPROVED
        ) {
            throw new ForbiddenException(
                'Hồ sơ đã gửi duyệt hoặc đã được duyệt, không thể chỉnh sửa.',
            );
        }
    }

    // Đảm bảo slug chưa được hồ sơ khác sử dụng, đồng thời cho phép hồ sơ hiện tại giữ slug của mình.
    async assertShopSlugAvailable(
        slug: string | null | undefined,
        applicationId?: string,
    ): Promise<void> {
        const normalizedSlug = toNullableString(slug);
        if (!normalizedSlug) return;
        const existing = await this.applicationRepository.findOne({
            where: {
                shopSlug: normalizedSlug,
                ...(applicationId ? { id: Not(applicationId) } : {}),
            },
        });
        if (existing)
            throw new ConflictException('Đường dẫn shop đã được sử dụng.');
    }

    // Kiểm tra điều khoản và các field bắt buộc trước để trả đúng lỗi thiếu dữ liệu.
    // Sau đó kiểm tra định dạng snapshot đã lưu, kể cả section request hiện tại không gửi.
    // Chỉ gọi Catalog khi dữ liệu nội bộ hợp lệ để tránh request downstream không cần thiết.
    async assertApplicationReady(
        application: SellerApplication,
        acceptedTerms: boolean,
    ): Promise<void> {
        if (!acceptedTerms)
            throw new BadRequestException(
                'Vui lòng đồng ý điều khoản người bán.',
            );
        const missingFields = this.getMissingRequiredFields(application);
        if (missingFields.length > 0) {
            throw new BadRequestException({
                message: 'Hồ sơ người bán chưa đủ thông tin để gửi duyệt.',
                missingFields,
            });
        }

        const invalidFields = this.getInvalidInputFields(application);
        if (invalidFields.length > 0) {
            throw new BadRequestException({
                message:
                    'Một số thông tin không đúng định dạng. Vui lòng kiểm tra lại.',
                invalidFields,
            });
        }

        await this.assertCategoryExists(application.mainCategoryId as string);
    }

    // Rà định dạng các giá trị quan trọng trên entity sau khi merge DTO với bản nháp.
    // Những mã định danh/điện thoại/tài khoản phải đúng pattern; các mã số được giữ ở dạng string.
    // Rule không chữ số chỉ áp dụng tên người, không áp vào tên shop hay pháp nhân doanh nghiệp.
    private getInvalidInputFields(application: SellerApplication): string[] {
        const invalidFields: string[] = [];
        // Thu thập đường dẫn field thay vì dừng ở lỗi đầu tiên để response chỉ đủ các ô cần sửa.
        const addWhenInvalid = (field: string, isValid: boolean) => {
            if (!isValid) invalidFields.push(field);
        };

        addWhenInvalid(
            'seller.representativeName',
            PERSON_NAME_PATTERN.test(application.representativeName ?? ''),
        );
        addWhenInvalid(
            'seller.phone',
            PHONE_PATTERN.test(application.contactPhone ?? ''),
        );
        addWhenInvalid(
            'pickupAddress.contactName',
            PERSON_NAME_PATTERN.test(application.pickupContactName ?? ''),
        );
        addWhenInvalid(
            'pickupAddress.phone',
            PHONE_PATTERN.test(application.pickupPhone ?? ''),
        );
        addWhenInvalid(
            'payout.accountNumber',
            /^\d{6,30}$/.test(application.bankAccountNumber ?? ''),
        );

        // Mã định danh phải đúng loại hồ sơ; số ở đầu được giữ vì các trường này lưu dưới dạng chuỗi.
        if (application.profileType === SellerProfileType.BUSINESS) {
            addWhenInvalid(
                'seller.taxCode',
                /^(\d{10}|\d{13})$/.test(application.taxCode ?? ''),
            );
        } else {
            addWhenInvalid(
                'seller.legalName',
                PERSON_NAME_PATTERN.test(application.legalName ?? ''),
            );
            addWhenInvalid(
                'seller.citizenId',
                /^(\d{9}|\d{12})$/.test(application.citizenId ?? ''),
            );
        }

        // Tên pháp nhân có thể chứa số, còn chủ tài khoản cá nhân phải là họ tên không có chữ số.
        if (application.bankAccountType === PayoutAccountType.PERSONAL) {
            addWhenInvalid(
                'payout.accountHolderName',
                PERSON_NAME_PATTERN.test(
                    application.bankAccountHolderName ?? '',
                ),
            );
        }

        return invalidFields;
    }

    // Gom các field bắt buộc thành field path để frontend hiển thị lỗi đúng section của form.
    private getMissingRequiredFields(application: SellerApplication): string[] {
        const requiredFields: Array<[string, unknown]> = [
            ['shop.name', application.shopName],
            ['shop.slug', application.shopSlug],
            ['shop.mainCategoryId', application.mainCategoryId],
            ['shop.businessModel', application.businessModel],
            ['shop.logoUrl', application.logoUrl],
            ['seller.legalName', application.legalName],
            ['seller.representativeName', application.representativeName],
            ['seller.phone', application.contactPhone],
            ['seller.email', application.contactEmail],
            ['pickupAddress.contactName', application.pickupContactName],
            ['pickupAddress.phone', application.pickupPhone],
            ['pickupAddress.provinceId', application.pickupGhnProvinceId],
            ['pickupAddress.provinceName', application.pickupGhnProvinceName],
            ['pickupAddress.districtId', application.pickupGhnDistrictId],
            ['pickupAddress.districtName', application.pickupGhnDistrictName],
            ['pickupAddress.wardCode', application.pickupGhnWardCode],
            ['pickupAddress.wardName', application.pickupGhnWardName],
            ['pickupAddress.addressLine', application.pickupAddressLine],
            ['payout.bankCode', application.bankCode],
            ['payout.bankName', application.bankName],
            ['payout.accountNumber', application.bankAccountNumber],
            ['payout.accountHolderName', application.bankAccountHolderName],
        ];

        if (application.profileType === SellerProfileType.BUSINESS) {
            requiredFields.push(['seller.taxCode', application.taxCode]);
            requiredFields.push([
                'seller.documents.businessLicense',
                this.getDocumentUrl(application, 'businessLicense'),
            ]);
            requiredFields.push([
                'seller.documents.representativeDocument',
                this.getDocumentUrl(application, 'representativeDocument'),
            ]);
        } else {
            requiredFields.push(['seller.citizenId', application.citizenId]);
            requiredFields.push([
                'seller.documents.citizenIdFront',
                this.getDocumentUrl(application, 'citizenIdFront'),
            ]);
            requiredFields.push([
                'seller.documents.citizenIdBack',
                this.getDocumentUrl(application, 'citizenIdBack'),
            ]);
        }

        return requiredFields
            .filter(([, value]) => !toNullableString(value))
            .map(([field]) => field);
    }

    // Đọc URL của giấy tờ từ object JSONB và loại bỏ shape không hợp lệ.
    private getDocumentUrl(
        application: SellerApplication,
        key: string,
    ): string | null {
        const document = application.verificationDocuments?.[key];
        if (!document || typeof document !== 'object') return null;
        const url = (document as Record<string, unknown>).url;
        return typeof url === 'string' ? url : null;
    }

    // Xác nhận category còn active tại thời điểm seller gửi hồ sơ.
    private async assertCategoryExists(categoryId: string): Promise<void> {
        try {
            const response = await firstValueFrom(
                this.http.get<ExternalCategoryResponse>(
                    this.buildServiceUrl(
                        this.catalogBaseUrl,
                        `/categories/${categoryId}`,
                    ),
                ),
            );
            if (!response.data.isActive)
                throw new BadRequestException(
                    'Ngành hàng đã chọn không còn hoạt động.',
                );
        } catch (err) {
            if (this.isAxiosStatus(err, 404))
                throw new BadRequestException(
                    'Ngành hàng đã chọn không hợp lệ.',
                );
            if (err instanceof BadRequestException) throw err;
            throw new BadGatewayException(
                'Không thể kiểm tra ngành hàng lúc này.',
            );
        }
    }

    // Ghép URL downstream với prefix API/v1 đúng chuẩn của service.
    private buildServiceUrl(baseUrl: string, path: string): string {
        return `${baseUrl.replace(/\/$/, '')}/api/v1${path}`;
    }

    // Chỉ nhận diện lỗi HTTP từ Axios để không nuốt các lỗi nghiệp vụ nội bộ.
    private isAxiosStatus(err: unknown, status: number): boolean {
        return err instanceof AxiosError && err.response?.status === status;
    }
}
