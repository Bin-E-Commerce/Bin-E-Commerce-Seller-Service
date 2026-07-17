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
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { toNullableString } from "../utils/seller-application-string.util";

// Contract tối thiểu seller-service cần từ catalog-service; không kéo toàn bộ model category sang bounded context này.
interface ExternalCategoryResponse {
  id: string;
  isActive: boolean;
}

// Contract tối thiểu dùng để kiểm tra loại địa giới, trạng thái và quan hệ cha-con.
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

  // Đọc URL service phụ thuộc một lần; các hàm validate chỉ ghép thêm prefix API/version đúng chuẩn từng service.
  constructor(
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.catalogBaseUrl = config.get<string>(
      "CATALOG_SERVICE_URL",
      "http://localhost:3003",
    );
    this.locationBaseUrl = config.get<string>(
      "LOCATION_SERVICE_URL",
      "http://localhost:3006",
    );
  }

  // Lưu nháp chỉ dành cho hồ sơ chưa từng gửi; hồ sơ bị trả lại phải giữ nguyên mốc review cho đến khi seller gửi lại thành công.
  assertDraftSaveAllowed(application: SellerApplication): void {
    if (application.status !== SellerApplicationStatus.DRAFT) {
      throw new ForbiddenException(
        "Chỉ hồ sơ đang ở trạng thái nháp mới có thể lưu nháp.",
      );
    }
  }

  // Chỉ DRAFT/REJECTED được gửi duyệt; khóa PENDING_REVIEW để dữ liệu admin đang đối chiếu không thay đổi giữa chừng.
  assertSubmissionAllowed(application: SellerApplication): void {
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
  // applicationId bị loại khỏi truy vấn để một hồ sơ được phép lưu lại chính slug hiện tại của nó.
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

  // Chạy validation theo thứ tự rẻ trước, đắt sau: điều khoản và field local phải hợp lệ rồi mới gọi service bên ngoài.
  // Cách này giảm request thừa tới catalog/location khi hồ sơ còn thiếu dữ liệu ngay trong seller-service.
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

    // Các ép kiểu dưới đây an toàn sau getMissingRequiredFields vì ID null/rỗng đã bị chặn trước khi gọi network.
    await this.assertCategoryExists(application.mainCategoryId as string);
    await this.assertLocationPairExists(
      application.pickupProvinceId as string,
      application.pickupWardId as string,
    );
  }

  // Gom rule submit vào một danh sách field-path để backend trả đúng vị trí lỗi cho form nhiều bước của FE.
  // Giấy tờ bắt buộc thay đổi theo profileType, tránh yêu cầu CCCD đối với doanh nghiệp và ngược lại.
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

    // Hồ sơ doanh nghiệp dùng giấy phép kinh doanh và giấy tờ người đại diện để admin đối chiếu pháp nhân.
    if (application.profileType === SellerProfileType.BUSINESS) {
      requiredFields.push(["seller.taxCode", application.taxCode]);
      requiredFields.push([
        "seller.documents.businessLicense",
        this.getDocumentUrl(application, "businessLicense"),
      ]);
      requiredFields.push([
        "seller.documents.representativeDocument",
        this.getDocumentUrl(application, "representativeDocument"),
      ]);
    } else {
      // Hồ sơ cá nhân/hộ kinh doanh phải có đủ hai mặt CCCD để kiểm tra số và nhận diện người đăng ký.
      requiredFields.push(["seller.citizenId", application.citizenId]);
      requiredFields.push([
        "seller.documents.citizenIdFront",
        this.getDocumentUrl(application, "citizenIdFront"),
      ]);
      requiredFields.push([
        "seller.documents.citizenIdBack",
        this.getDocumentUrl(application, "citizenIdBack"),
      ]);
    }

    // Dùng cùng quy tắc chuẩn hóa chuỗi với mapper để khoảng trắng cũng được xem là chưa nhập.
    return requiredFields
      .filter(([, value]) => !toNullableString(value as string | null))
      .map(([field]) => field);
  }

  // Chỉ đọc thuộc tính url từ object giấy tờ; giá trị khác shape không được xem là tài liệu hợp lệ.
  private getDocumentUrl(
    application: SellerApplication,
    key: string,
  ): string | null {
    const document = application.verificationDocuments?.[key];

    if (!document || typeof document !== "object") return null;

    const url = (document as Record<string, unknown>).url;
    return typeof url === "string" ? url : null;
  }

  // Gọi trực tiếp catalog-service để xác nhận category còn active tại đúng thời điểm submit.
  // 404 là dữ liệu người dùng không hợp lệ, còn lỗi timeout/5xx được chuyển thành 502 vì phụ thuộc đang gián đoạn.
  private async assertCategoryExists(categoryId: string): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ExternalCategoryResponse>(
          this.buildServiceUrl(this.catalogBaseUrl, `/categories/${categoryId}`),
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

  // Đọc tỉnh và phường song song vì hai tài nguyên độc lập, sau đó kiểm tra type, trạng thái và quan hệ cha-con.
  private async assertLocationPairExists(
    provinceId: string,
    wardId: string,
  ): Promise<void> {
    try {
      // Promise.all giảm một vòng chờ network nhưng vẫn fail toàn bộ nếu một trong hai địa giới không đọc được.
      const [provinceResponse, wardResponse] = await Promise.all([
        firstValueFrom(
          this.http.get<ExternalLocationResponse>(
            this.buildServiceUrl(this.locationBaseUrl, `/locations/${provinceId}`),
          ),
        ),
        firstValueFrom(
          this.http.get<ExternalLocationResponse>(
            this.buildServiceUrl(this.locationBaseUrl, `/locations/${wardId}`),
          ),
        ),
      ]);

      const province = provinceResponse.data;
      const ward = wardResponse.data;

      // Không chỉ kiểm tra tồn tại: ID của district hoặc địa giới đã tắt cũng không được dùng làm địa chỉ lấy hàng.
      if (
        !province.isActive ||
        !ward.isActive ||
        province.type !== "province" ||
        ward.type !== "ward"
      ) {
        throw new BadRequestException("Địa chỉ lấy hàng không hợp lệ.");
      }

      // Dataset hiện tại tổ chức province -> ward trực tiếp; rule này phải đổi nếu sau này thêm cấp district bắt buộc.
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

  // Chuẩn hóa dấu gạch cuối base URL rồi ghép prefix nội bộ /api/v1 để tránh sinh URL có hai dấu //.
  private buildServiceUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/$/, "")}/api/v1${path}`;
  }

  // Chỉ bóc status từ AxiosError; lỗi code nội bộ không bị hiểu nhầm thành phản hồi HTTP của downstream service.
  private isAxiosStatus(err: unknown, status: number): boolean {
    return err instanceof AxiosError && err.response?.status === status;
  }
}
