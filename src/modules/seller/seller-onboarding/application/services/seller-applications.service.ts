import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { CurrentUserContext } from "../types/current-user-context.type";
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

  // Lấy hồ sơ seller hiện tại của user đăng nhập; trả null để FE biết user chưa từng bắt đầu onboarding.
  async getMyApplication(
    currentUser: CurrentUserContext,
  ): Promise<SellerApplicationResponseDto | null> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    return application ? this.mapper.toResponse(application) : null;
  }

  // Lưu nháp từng bước đăng ký; nhánh này chưa yêu cầu đủ toàn bộ hồ sơ để user có thể quay lại hoàn thiện sau.
  async saveDraft(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    // Hồ sơ đã gửi duyệt hoặc đã được duyệt không được sửa bằng luồng nháp để tránh thay đổi dữ liệu admin đang xử lý.
    this.validator.assertEditable(application);

    // Slug shop là định danh public, nên kiểm tra trùng trước khi map DTO để tránh tự so với chính bản ghi hiện tại.
    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );

    // Mapper chịu trách nhiệm chuẩn hóa input rỗng thành null và chỉ copy các field được phép từ DTO vào entity.
    this.mapper.applyDto(application, dto);
    application.status = SellerApplicationStatus.DRAFT;

    const saved = await this.applicationRepository.save(application);
    return this.mapper.toResponse(saved);
  }

  // Gửi hồ sơ duyệt; khác saveDraft ở chỗ bắt buộc validate đủ dữ liệu và phát event thông báo sau khi lưu thành công.
  async submit(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    // Submit chỉ hợp lệ với hồ sơ còn có thể chỉnh sửa, tránh user gửi lại hồ sơ đang pending hoặc đã approved.
    this.validator.assertEditable(application);

    // Kiểm tra slug trước khi đổi dữ liệu entity để lỗi trả về đúng ngữ cảnh field user vừa nhập.
    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );

    this.mapper.applyDto(application, dto);

    // Rule submit nằm ở backend để FE không thể bypass các field bắt buộc, category/location thật và điều khoản.
    await this.validator.assertApplicationReady(
      application,
      dto.acceptedTerms === true,
    );

    // Từ thời điểm này hồ sơ chuyển sang hàng chờ admin duyệt, đồng thời reset ghi chú review cũ nếu trước đó từng bị từ chối.
    application.status = SellerApplicationStatus.PENDING_REVIEW;
    application.submittedAt = new Date();
    application.reviewNote = null;
    application.reviewedAt = null;

    const saved = await this.applicationRepository.save(application);

    // Kafka event gửi sau khi DB save thành công để email không thông báo một hồ sơ chưa tồn tại hoặc chưa đúng trạng thái.
    await this.events.publishSubmittedEmail(saved);

    return this.mapper.toResponse(saved);
  }

  // Tạo context user từ headers qua provider riêng để controller không phải biết chi tiết header do API Gateway inject.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): CurrentUserContext {
    return this.auth.buildCurrentUserFromHeaders(headers);
  }

  // Tìm hồ sơ hiện tại hoặc tạo bản nháp mặc định cho user lần đầu mở form đăng ký seller.
  private async getOrCreateDraft(
    user: CurrentUserContext,
  ): Promise<SellerApplication> {
    const existing = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    if (existing) return existing;

    // Giá trị mặc định giúp form bước đầu có loại hồ sơ và loại tài khoản thanh toán ổn định ngay cả khi FE chưa gửi.
    return this.applicationRepository.create({
      userId: user.userId,
      userEmail: user.email,
      status: SellerApplicationStatus.DRAFT,
      profileType: SellerProfileType.INDIVIDUAL,
      bankAccountType: PayoutAccountType.PERSONAL,
    });
  }
}
