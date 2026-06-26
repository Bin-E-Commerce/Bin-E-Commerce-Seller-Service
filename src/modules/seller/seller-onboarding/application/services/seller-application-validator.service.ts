import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { AxiosError } from "axios";
import { firstValueFrom } from "rxjs";
import { Not, Repository } from "typeorm";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { toNullableString } from "../utils/seller-application-string.util";

interface ExternalCategoryResponse {
  id: string;
  isActive: boolean;
}

interface ExternalLocationResponse {
  id: string;
  parentId: string | null;
  type: "province" | "district" | "ward";
  isActive: boolean;
}

@Injectable()
export class SellerApplicationValidatorService {
  private readonly catalogBaseUrl: string;
  private readonly locationBaseUrl: string;

  // Đọc URL service phụ thuộc một lần để các request validate không phải tự xử lý config.
  constructor(
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.catalogBaseUrl = config.get<string>(
      "CATALOG_SERVICE_URL",
      "http://localhost:3005",
    );
    this.locationBaseUrl = config.get<string>(
      "LOCATION_SERVICE_URL",
      "http://localhost:3006",
    );
  }

  // Chỉ draft/rejected được chỉnh; pending/approved cần admin xử lý để tránh đổi hồ sơ sau khi gửi duyệt.
  assertEditable(application: SellerApplication): void {
    if (
      application.status === SellerApplicationStatus.PENDING_REVIEW ||
      application.status === SellerApplicationStatus.APPROVED
    ) {
      throw new ForbiddenException(
        "Hồ sơ đã gửi duyệt hoặc đã được duyệt, không thể chỉnh sửa.",
      );
    }
  }

  // Kiểm tra slug shop trùng trước khi save để trả lỗi nghiệp vụ rõ hơn lỗi unique index.
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

    if (existing) {
      throw new ConflictException("Đường dẫn shop đã được sử dụng.");
    }
  }

  // Kiểm tra toàn bộ hồ sơ trước khi submit, bao gồm trường bắt buộc và master data thật.
  async assertApplicationReady(
    application: SellerApplication,
    acceptedTerms: boolean,
  ): Promise<void> {
    if (!acceptedTerms) {
      throw new BadRequestException("Vui lòng đồng ý điều khoản người bán.");
    }

    const missingFields = this.getMissingRequiredFields(application);
    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: "Hồ sơ người bán chưa đủ thông tin để gửi duyệt.",
        missingFields,
      });
    }

    await this.assertCategoryExists(application.mainCategoryId as string);
    await this.assertLocationPairExists(
      application.pickupProvinceId as string,
      application.pickupWardId as string,
    );
  }

  // Tập trung rule bắt buộc theo profileType để cá nhân và doanh nghiệp không dùng nhầm giấy tờ.
  private getMissingRequiredFields(application: SellerApplication): string[] {
    const requiredFields: Array<[string, unknown]> = [
      ["shop.name", application.shopName],
      ["shop.slug", application.shopSlug],
      ["shop.mainCategoryId", application.mainCategoryId],
      ["shop.businessModel", application.businessModel],
      ["shop.logoUrl", application.logoUrl],
      ["seller.legalName", application.legalName],
      ["seller.representativeName", application.representativeName],
      ["seller.phone", application.contactPhone],
      ["seller.email", application.contactEmail],
      ["pickupAddress.contactName", application.pickupContactName],
      ["pickupAddress.phone", application.pickupPhone],
      ["pickupAddress.provinceId", application.pickupProvinceId],
      ["pickupAddress.wardId", application.pickupWardId],
      ["pickupAddress.addressLine", application.pickupAddressLine],
      ["payout.bankCode", application.bankCode],
      ["payout.bankName", application.bankName],
      ["payout.accountNumber", application.bankAccountNumber],
      ["payout.accountHolderName", application.bankAccountHolderName],
    ];

    if (application.profileType === SellerProfileType.BUSINESS) {
      requiredFields.push(["seller.taxCode", application.taxCode]);
    } else {
      requiredFields.push(["seller.citizenId", application.citizenId]);
    }

    return requiredFields
      .filter(([, value]) => !toNullableString(value as string | null))
      .map(([field]) => field);
  }

  // Gọi catalog-service để đảm bảo category FE gửi lên vẫn tồn tại và còn active.
  private async assertCategoryExists(categoryId: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ExternalCategoryResponse>(
          `${this.catalogBaseUrl}/catalog/categories/${categoryId}`,
        ),
      );

      if (!response.data.isActive) {
        throw new BadRequestException(
          "Ngành hàng đã chọn không còn hoạt động.",
        );
      }
    } catch (err) {
      if (this.isAxiosStatus(err, 404)) {
        throw new BadRequestException("Ngành hàng đã chọn không hợp lệ.");
      }

      if (err instanceof BadRequestException) throw err;
      throw new BadGatewayException("Không thể kiểm tra ngành hàng lúc này.");
    }
  }

  // Gọi location-service để đảm bảo phường/xã thuộc đúng tỉnh/thành đã chọn.
  private async assertLocationPairExists(
    provinceId: string,
    wardId: string,
  ): Promise<void> {
    try {
      const [provinceResponse, wardResponse] = await Promise.all([
        firstValueFrom(
          this.http.get<ExternalLocationResponse>(
            `${this.locationBaseUrl}/locations/${provinceId}`,
          ),
        ),
        firstValueFrom(
          this.http.get<ExternalLocationResponse>(
            `${this.locationBaseUrl}/locations/${wardId}`,
          ),
        ),
      ]);

      const province = provinceResponse.data;
      const ward = wardResponse.data;

      if (
        !province.isActive ||
        !ward.isActive ||
        province.type !== "province" ||
        ward.type !== "ward"
      ) {
        throw new BadRequestException("Địa chỉ lấy hàng không hợp lệ.");
      }

      if (ward.parentId !== province.id) {
        throw new BadRequestException(
          "Phường/xã không thuộc tỉnh/thành đã chọn.",
        );
      }
    } catch (err) {
      if (this.isAxiosStatus(err, 404)) {
        throw new BadRequestException("Địa chỉ lấy hàng không hợp lệ.");
      }

      if (err instanceof BadRequestException) throw err;
      throw new BadGatewayException("Không thể kiểm tra địa chỉ lúc này.");
    }
  }

  // Nhận diện lỗi HTTP từ các service master data để chuyển thành lỗi nghiệp vụ dễ hiểu.
  private isAxiosStatus(err: unknown, status: number): boolean {
    return err instanceof AxiosError && err.response?.status === status;
  }
}
