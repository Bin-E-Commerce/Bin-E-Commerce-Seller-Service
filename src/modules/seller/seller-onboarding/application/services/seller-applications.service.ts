import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { ListSellerApplicationsQueryDto } from "../../presentation/dto/list-seller-applications-query.dto";
import { ListSellerApplicationsResponseDto } from "../../presentation/dto/list-seller-applications-response.dto";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { CurrentUserContext } from "../types/current-user-context.type";
import { SellerApplicationAuthService } from "./seller-application-auth.service";
import { SellerApplicationEventsService } from "./seller-application-events.service";
import { SellerApplicationMapper } from "./seller-application.mapper";
import { SellerApplicationValidatorService } from "./seller-application-validator.service";

@Injectable()
export class SellerApplicationsService {
  // Service này điều phối use case; auth, validation, mapping và event được tách provider để mỗi rule có một nơi chịu trách nhiệm.
  constructor(
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly auth: SellerApplicationAuthService,
    private readonly validator: SellerApplicationValidatorService,
    private readonly mapper: SellerApplicationMapper,
    private readonly events: SellerApplicationEventsService,
  ) {}

  // Lấy hồ sơ theo userId từ context tin cậy; trả null để FE phân biệt "chưa bắt đầu" với một bản DRAFT rỗng.
  async getMyApplication(
    currentUser: CurrentUserContext,
  ): Promise<SellerApplicationResponseDto | null> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    return application ? this.mapper.toResponse(application) : null;
  }

  // Lấy danh sách review theo permission, phân trang ở DB và chỉ hỗ trợ các bộ lọc cần cho màn hình admin hiện tại.
  async listForAdmin(
    currentUser: CurrentUserContext,
    query: ListSellerApplicationsQueryDto,
  ): Promise<ListSellerApplicationsResponseDto> {
    this.auth.ensureStaffUser(currentUser);

    const page = query.page;
    const pageSize = query.pageSize;
    // Áp dụng phân trang ngay trong SQL để không nạp toàn bộ hồ sơ chứa dữ liệu nhạy cảm vào bộ nhớ service.
    const builder = this.applicationRepository
      .createQueryBuilder("application")
      .orderBy("application.updatedAt", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.status) {
      builder.andWhere("application.status = :status", {
        status: query.status,
      });
    }

    // Gom search vào một cụm OR để admin có thể tìm cùng lúc theo shop, slug, email hoặc tên pháp lý.
    const search = query.search?.trim();
    if (search) {
      builder.andWhere(
        `(
          application.shopName ILIKE :search
          OR application.shopSlug ILIKE :search
          OR application.userEmail ILIKE :search
          OR application.legalName ILIKE :search
        )`,
        { search: `%${search}%` },
      );
    }

    // TypeORM trả dữ liệu trang hiện tại và tổng số bản ghi cùng điều kiện để FE tính phân trang chính xác.
    const [items, totalItems] = await builder.getManyAndCount();

    return {
      items: items.map((application) => this.mapper.toResponse(application)),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
  }

  // Lấy chi tiết cho admin và kiểm tra permission lần hai ở service, phòng trường hợp route nội bộ bị gọi ngoài gateway.
  async getForAdmin(
    currentUser: CurrentUserContext,
    applicationId: string,
  ): Promise<SellerApplicationResponseDto> {
    this.auth.ensureStaffUser(currentUser);

    const application = await this.applicationRepository.findOne({
      where: { id: applicationId },
    });

    if (!application) {
      throw new NotFoundException("Không tìm thấy hồ sơ người bán.");
    }

    return this.mapper.toResponse(application);
  }

  // Lưu snapshot của các bước được gửi lên mà chưa chạy rule đầy đủ; user có thể thoát và tiếp tục onboarding sau.
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

    // save() vừa INSERT bản nháp mới vừa UPDATE hồ sơ cũ; unique index DB vẫn là lớp bảo vệ cuối cho userId/slug.
    const saved = await this.applicationRepository.save(application);
    return this.mapper.toResponse(saved);
  }

  // Hoàn tất onboarding theo chuỗi: xác thực -> khóa trạng thái -> map DTO -> validate -> lưu pending -> phát event.
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

  // Tìm hồ sơ theo unique userId; nếu chưa có chỉ tạo entity trong bộ nhớ, DB chỉ INSERT khi saveDraft/submit thành công.
  private async getOrCreateDraft(
    user: CurrentUserContext,
  ): Promise<SellerApplication> {
    const existing = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    // Luôn trả hồ sơ bất kể trạng thái; assertEditable phía use case quyết định có được thay đổi hay không.
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
