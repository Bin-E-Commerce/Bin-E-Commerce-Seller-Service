import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { CurrentUserContext } from "../../domain/types/current-user-context.type";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { SellerApplicationAuthService } from "./seller-application-auth.service";
import { SellerApplicationEventsService } from "./seller-application-events.service";
import { SellerApplicationMapper } from "./seller-application.mapper";
import { SellerApplicationValidatorService } from "./seller-application-validator.service";

@Injectable()
export class SellerApplicationsService {
  constructor(
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly auth: SellerApplicationAuthService,
    private readonly validator: SellerApplicationValidatorService,
    private readonly mapper: SellerApplicationMapper,
    private readonly events: SellerApplicationEventsService,
  ) {}

  // Lấy hồ sơ hiện tại của user; chưa có thì trả null để FE biết cần bắt đầu đăng ký.
  async getMyApplication(
    currentUser: CurrentUserContext,
  ): Promise<SellerApplicationResponseDto | null> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    return application ? this.mapper.toResponse(application) : null;
  }

  // Lưu nháp hồ sơ seller; chỉ user đăng nhập mới được lưu hồ sơ của chính mình.
  async saveDraft(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    this.validator.assertEditable(application);
    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );
    this.mapper.applyDto(application, dto);
    application.status = SellerApplicationStatus.DRAFT;

    const saved = await this.applicationRepository.save(application);
    return this.mapper.toResponse(saved);
  }

  // Gửi hồ sơ duyệt: backend validate đầy đủ, kiểm tra master data và phát Kafka event gửi email.
  async submit(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    this.validator.assertEditable(application);
    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );
    this.mapper.applyDto(application, dto);

    await this.validator.assertApplicationReady(
      application,
      dto.acceptedTerms === true,
    );

    application.status = SellerApplicationStatus.PENDING_REVIEW;
    application.submittedAt = new Date();
    application.reviewNote = null;
    application.reviewedAt = null;

    const saved = await this.applicationRepository.save(application);
    await this.events.publishSubmittedEmail(saved);

    return this.mapper.toResponse(saved);
  }

  // Tạo context user từ headers qua provider riêng để controller không phải biết cách parse header.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): CurrentUserContext {
    return this.auth.buildCurrentUserFromHeaders(headers);
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
}
