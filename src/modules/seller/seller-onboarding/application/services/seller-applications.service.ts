import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { InjectRepository } from "@nestjs/typeorm";
import { AxiosError } from "axios";
import { firstValueFrom } from "rxjs";
import { Not, Repository } from "typeorm";
import {
  SellerEvents,
  SellerApplicationSubmittedPayload,
} from "@common/kafka/events";
import { SellerApplication } from "../../../database/entities/seller-application.entity";
import { KafkaProducerService } from "../../../kafka/kafka-producer.service";
import { SaveSellerApplicationDto } from "../dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../dto/seller-application-response.dto";
import { SellerApplicationStatus } from "../enums/seller-application-status.enum";
import { SellerProfileType } from "../enums/seller-profile-type.enum";
import { PayoutAccountType } from "../enums/payout-account-type.enum";
import { CurrentUserContext } from "../types/current-user-context.type";

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
export class SellerApplicationsService {
  private readonly catalogBaseUrl: string;
  private readonly locationBaseUrl: string;

  constructor(
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    this.catalogBaseUrl = this.config.get<string>(
      "CATALOG_SERVICE_URL",
      "http://localhost:3003",
    );
    this.locationBaseUrl = this.config.get<string>(
      "LOCATION_SERVICE_URL",
      "http://localhost:3006",
    );
  }

  // Lấy hồ sơ hiện tại của user; chưa có thì trả null để FE biết cần bắt đầu đăng ký.
  async getMyApplication(
    currentUser: CurrentUserContext,
  ): Promise<SellerApplicationResponseDto | null> {
    const user = this.ensureAuthenticatedUser(currentUser);
    const application = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    return application ? this.toResponse(application) : null;
  }

  // Lưu nháp hồ sơ seller; chỉ user đang đăng nhập mới được lưu hồ sơ của chính mình.
  async saveDraft(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    this.assertEditable(application);
    await this.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );
    this.applyDto(application, dto);
    application.status = SellerApplicationStatus.DRAFT;

    const saved = await this.applicationRepository.save(application);
    return this.toResponse(saved);
  }

  // Gửi hồ sơ duyệt: backend tự validate đầy đủ, kiểm tra master data và phát Kafka event gửi email.
  async submit(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    this.assertEditable(application);
    await this.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );
    this.applyDto(application, dto);

    await this.assertApplicationReady(application, dto.acceptedTerms === true);

    application.status = SellerApplicationStatus.PENDING_REVIEW;
    application.submittedAt = new Date();
    application.reviewNote = null;
    application.reviewedAt = null;

    const saved = await this.applicationRepository.save(application);
    await this.publishSubmittedEmail(saved);

    return this.toResponse(saved);
  }

  // Tạo context user từ headers do API Gateway inject; service không tin dữ liệu truyền từ body.
  buildCurrentUserFromHeaders(headers: Record<string, unknown>): CurrentUserContext {
    const userId = this.getHeaderValue(headers, "x-user-id");
    const email = this.getHeaderValue(headers, "x-user-email");
    const rolesHeader = this.getHeaderValue(headers, "x-user-roles") ?? "";

    return {
      userId: userId ?? "",
      email: email ?? "",
      roles: rolesHeader
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
    };
  }

  // Đảm bảo downstream chỉ xử lý người dùng đã đăng nhập và đã có email trong token.
  private ensureAuthenticatedUser(
    currentUser: CurrentUserContext,
  ): CurrentUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException("Bạn cần đăng nhập để đăng ký người bán.");
    }

    return currentUser;
  }

  // Tìm hồ sơ hiện tại hoặc tạo bản nháp mới cho user lần đầu mở form seller.
  private async getOrCreateDraft(
    user: CurrentUserContext,
  ): Promise<SellerApplication> {
    const existing = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    if (existing) return existing;

    return this.applicationRepository.create({
      userId: user.userId,
      userEmail: user.email,
      status: SellerApplicationStatus.DRAFT,
      profileType: SellerProfileType.INDIVIDUAL,
      bankAccountType: PayoutAccountType.PERSONAL,
    });
  }

  // Chỉ draft/rejected được chỉnh; pending/approved cần admin xử lý để tránh thay đổi sau khi gửi duyệt.
  private assertEditable(application: SellerApplication): void {
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
  private async assertShopSlugAvailable(
    slug: string | undefined,
    applicationId: string | undefined,
  ): Promise<void> {
    const normalizedSlug = this.toNullableString(slug);
    if (!normalizedSlug) return;

    const duplicated = applicationId
      ? await this.applicationRepository.findOne({
          where: {
            shopSlug: normalizedSlug,
            id: Not(applicationId),
          },
        })
      : await this.applicationRepository.findOne({
          where: { shopSlug: normalizedSlug },
        });

    if (duplicated) {
      throw new ConflictException("Đường dẫn shop đã được sử dụng.");
    }
  }

  // Áp dữ liệu DTO vào entity theo từng nhóm để tránh body từ FE ghi thẳng vào field nhạy cảm.
  private applyDto(
    application: SellerApplication,
    dto: SaveSellerApplicationDto,
  ): void {
    if (dto.shop) {
      application.shopName = this.toNullableString(dto.shop.name);
      application.shopSlug = this.toNullableString(dto.shop.slug);
      application.mainCategoryId = this.toNullableString(dto.shop.mainCategoryId);
      application.businessModel = this.toNullableString(dto.shop.businessModel);
      application.shopDescription = this.toNullableString(dto.shop.description);
      application.logoUrl = this.toNullableString(dto.shop.logoUrl);
    }

    if (dto.seller) {
      application.profileType =
        dto.seller.profileType ?? SellerProfileType.INDIVIDUAL;
      application.legalName = this.toNullableString(dto.seller.legalName);
      application.citizenId = this.toNullableString(dto.seller.citizenId);
      application.taxCode = this.toNullableString(dto.seller.taxCode);
      application.representativeName = this.toNullableString(
        dto.seller.representativeName,
      );
      application.representativeRole = this.toNullableString(
        dto.seller.representativeRole,
      );
      application.contactPhone = this.toNullableString(dto.seller.phone);
      application.contactEmail = this.toNullableString(dto.seller.email);
      application.verificationDocuments = dto.seller.documents ?? {};
    }

    if (dto.pickupAddress) {
      application.pickupContactName = this.toNullableString(
        dto.pickupAddress.contactName,
      );
      application.pickupPhone = this.toNullableString(dto.pickupAddress.phone);
      application.pickupProvinceId = this.toNullableString(
        dto.pickupAddress.provinceId,
      );
      application.pickupWardId = this.toNullableString(dto.pickupAddress.wardId);
      application.pickupAddressLine = this.toNullableString(
        dto.pickupAddress.addressLine,
      );
    }

    if (dto.payout) {
      application.bankCode = this.toNullableString(dto.payout.bankCode);
      application.bankName = this.toNullableString(dto.payout.bankName);
      application.bankAccountNumber = this.toNullableString(
        dto.payout.accountNumber,
      );
      application.bankAccountHolderName = this.toNullableString(
        dto.payout.accountHolderName,
      );
      application.bankAccountType =
        dto.payout.accountType ?? PayoutAccountType.PERSONAL;
      application.bankBranch = this.toNullableString(dto.payout.branch);
    }
  }

  // Kiểm tra toàn bộ hồ sơ trước khi submit, bao gồm trường bắt buộc và master data thật.
  private async assertApplicationReady(
    application: SellerApplication,
    acceptedTerms: boolean,
  ): Promise<void> {
    const missingFields = this.getMissingRequiredFields(application);

    if (!acceptedTerms) {
      missingFields.push("acceptedTerms");
    }

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: "Hồ sơ người bán chưa đủ thông tin để gửi duyệt.",
        missingFields,
      });
    }

    await Promise.all([
      this.assertCategoryExists(application.mainCategoryId),
      this.assertLocationPairExists(
        application.pickupProvinceId,
        application.pickupWardId,
      ),
    ]);
  }

  // Tập trung rule bắt buộc theo profileType để cá nhân và doanh nghiệp không dùng nhầm giấy tờ.
  private getMissingRequiredFields(application: SellerApplication): string[] {
    const required: Array<[string, string | null]> = [
      ["shop.name", application.shopName],
      ["shop.slug", application.shopSlug],
      ["shop.mainCategoryId", application.mainCategoryId],
      ["shop.businessModel", application.businessModel],
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
      required.push(["seller.taxCode", application.taxCode]);
    } else {
      required.push(["seller.citizenId", application.citizenId]);
    }

    return required
      .filter(([, value]) => !this.toNullableString(value))
      .map(([field]) => field);
  }

  // Gọi catalog-service để đảm bảo category FE gửi lên vẫn tồn tại và còn active.
  private async assertCategoryExists(categoryId: string | null): Promise<void> {
    if (!categoryId) return;

    try {
      const response = await firstValueFrom(
        this.httpService.get<ExternalCategoryResponse>(
          `${this.catalogBaseUrl}/api/v1/categories/${categoryId}`,
        ),
      );

      if (!response.data.isActive) {
        throw new BadRequestException("Ngành hàng đã chọn không còn hoạt động.");
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
    provinceId: string | null,
    wardId: string | null,
  ): Promise<void> {
    if (!provinceId || !wardId) return;

    try {
      const [provinceResponse, wardResponse] = await Promise.all([
        firstValueFrom(
          this.httpService.get<ExternalLocationResponse>(
            `${this.locationBaseUrl}/api/v1/locations/${provinceId}`,
          ),
        ),
        firstValueFrom(
          this.httpService.get<ExternalLocationResponse>(
            `${this.locationBaseUrl}/api/v1/locations/${wardId}`,
          ),
        ),
      ]);

      const province = provinceResponse.data;
      const ward = wardResponse.data;

      if (province.type !== "province" || ward.type !== "ward") {
        throw new BadRequestException("Địa chỉ lấy hàng không hợp lệ.");
      }

      if (ward.parentId !== province.id) {
        throw new BadRequestException(
          "Phường/xã không thuộc tỉnh/thành đã chọn.",
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;

      if (this.isAxiosStatus(err, 404)) {
        throw new BadRequestException("Địa chỉ lấy hàng không hợp lệ.");
      }

      throw new BadGatewayException("Không thể kiểm tra địa chỉ lúc này.");
    }
  }

  // Publish event cho notification-service gửi email xác nhận đang chờ duyệt.
  private async publishSubmittedEmail(
    application: SellerApplication,
  ): Promise<void> {
    if (!application.submittedAt || !application.shopName) return;

    const payload: SellerApplicationSubmittedPayload = {
      userId: application.userId,
      email: application.userEmail,
      applicationId: application.id,
      shopName: application.shopName,
      submittedAt: application.submittedAt.toISOString(),
    };

    await this.kafkaProducer.publish(SellerEvents.APPLICATION_SUBMITTED, payload);
  }

  // Chuyển entity sang response contract để FE không phụ thuộc cấu trúc bảng.
  private toResponse(
    application: SellerApplication,
  ): SellerApplicationResponseDto {
    return {
      id: application.id,
      status: application.status,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      reviewNote: application.reviewNote,
      shop: {
        name: application.shopName,
        slug: application.shopSlug,
        mainCategoryId: application.mainCategoryId,
        businessModel: application.businessModel,
        description: application.shopDescription,
        logoUrl: application.logoUrl,
      },
      seller: {
        profileType: application.profileType,
        legalName: application.legalName,
        citizenId: application.citizenId,
        taxCode: application.taxCode,
        representativeName: application.representativeName,
        representativeRole: application.representativeRole,
        phone: application.contactPhone,
        email: application.contactEmail,
        documents: application.verificationDocuments,
      },
      pickupAddress: {
        contactName: application.pickupContactName,
        phone: application.pickupPhone,
        provinceId: application.pickupProvinceId,
        wardId: application.pickupWardId,
        addressLine: application.pickupAddressLine,
      },
      payout: {
        bankCode: application.bankCode,
        bankName: application.bankName,
        accountNumber: application.bankAccountNumber,
        accountHolderName: application.bankAccountHolderName,
        accountType: application.bankAccountType,
        branch: application.bankBranch,
      },
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }

  // Chuẩn hóa chuỗi rỗng từ FE thành null để rule missing/unique hoạt động ổn định.
  private toNullableString(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  // Đọc header dạng lowercase vì Node/Nest chuẩn hóa header request thành lowercase.
  private getHeaderValue(
    headers: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }

  // Nhận diện lỗi HTTP từ các service master data để chuyển thành lỗi nghiệp vụ dễ hiểu.
  private isAxiosStatus(err: unknown, status: number): boolean {
    return err instanceof AxiosError && err.response?.status === status;
  }
}
