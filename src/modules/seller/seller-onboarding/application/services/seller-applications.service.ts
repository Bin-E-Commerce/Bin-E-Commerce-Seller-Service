import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { ListSellerApplicationsQueryDto } from "../../presentation/dto/list-seller-applications-query.dto";
import { ListSellerApplicationsResponseDto } from "../../presentation/dto/list-seller-applications-response.dto";
import { RejectSellerApplicationDto } from "../../presentation/dto/reject-seller-application.dto";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { CurrentUserContext } from "../types/current-user-context.type";
import { SellerApplicationAuthService } from "./seller-application-auth.service";
import { SellerApplicationEventsService } from "./seller-application-events.service";
import { SellerApplicationMapper } from "./seller-application.mapper";
import { SellerApplicationValidatorService } from "./seller-application-validator.service";
import { SellerApplicationCorrectionService } from "./seller-application-correction.service";

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
    private readonly corrections: SellerApplicationCorrectionService,
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

  // Từ chối một hồ sơ đang chờ duyệt, lưu lý do cho seller và phát sự kiện email sau khi trạng thái đã được ghi thành công.
  async rejectForAdmin(
    currentUser: CurrentUserContext,
    applicationId: string,
    dto: RejectSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    this.auth.ensureCanRejectApplication(currentUser);

    const reviewNote = dto.reason.trim();
    const reviewedAt = new Date();

    // Khóa hàng trong transaction để snapshot luôn được chụp từ đúng phiên bản mà admin vừa từ chối.
    // Nếu seller hoặc admin khác đang cập nhật cùng lúc, request đến sau phải chờ và đọc lại trạng thái mới nhất.
    const rejected = await this.applicationRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(SellerApplication);
        const application = await repository.findOne({
          where: { id: applicationId },
          lock: { mode: "pessimistic_write" },
        });

        if (!application) {
          throw new NotFoundException("Không tìm thấy hồ sơ người bán.");
        }

        if (application.status !== SellerApplicationStatus.PENDING_REVIEW) {
          throw new ConflictException(
            "Hồ sơ đã được xử lý hoặc không còn ở trạng thái chờ duyệt.",
          );
        }

        // Snapshot chỉ chứa hash của từng nhóm được chọn, đủ kiểm chứng thay đổi mà không nhân bản CCCD hoặc tài khoản ngân hàng.
        application.correctionSnapshotHashes =
          this.corrections.captureSnapshotHashes(
            application,
            dto.correctionTargets,
          );
        application.correctionTargets = dto.correctionTargets;
        application.status = SellerApplicationStatus.REJECTED;
        application.reviewNote = reviewNote;
        application.reviewedAt = reviewedAt;

        return repository.save(application);
      },
    );

    // Publish sau khi update thành công để email không báo từ chối khi DB vẫn còn pending_review.
    await this.events.publishRejected(rejected);
    return this.mapper.toResponse(rejected);
  }

  // Chấp thuận hồ sơ đang chờ duyệt và chỉ phát sự kiện cấp quyền sau khi transaction đã ghi nhận trạng thái thành công.
  async approveForAdmin(
    currentUser: CurrentUserContext,
    applicationId: string,
  ): Promise<SellerApplicationResponseDto> {
    this.auth.ensureCanApproveApplication(currentUser);

    // Khóa bản ghi để hai admin không thể duyệt hoặc từ chối cùng một hồ sơ tại cùng thời điểm.
    const approved = await this.applicationRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(SellerApplication);
        const application = await repository.findOne({
          where: { id: applicationId },
          lock: { mode: "pessimistic_write" },
        });

        if (!application) {
          throw new NotFoundException("Không tìm thấy hồ sơ người bán.");
        }

        if (application.status !== SellerApplicationStatus.PENDING_REVIEW) {
          throw new ConflictException(
            "Hồ sơ đã được xử lý hoặc không còn ở trạng thái chờ duyệt.",
          );
        }

        // Xóa toàn bộ yêu cầu sửa cũ vì phiên bản hiện tại đã được admin xác nhận hợp lệ.
        application.status = SellerApplicationStatus.APPROVED;
        application.reviewedAt = new Date();
        application.reviewNote = null;
        application.correctionTargets = [];
        application.correctionSnapshotHashes = {};

        return repository.save(application);
      },
    );

    // Kafka event được phát sau commit để consumer không cấp role SELLER cho một transaction đã rollback.
    await this.events.publishApproved(approved);
    return this.mapper.toResponse(approved);
  }

  // Lưu snapshot của các bước được gửi lên mà chưa chạy rule đầy đủ; user có thể thoát và tiếp tục onboarding sau.
  async saveDraft(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.getOrCreateDraft(user);

    // Hồ sơ bị từ chối không được chuyển ngược thành draft; seller phải sửa trong form và gửi lại thành một revision mới.
    this.validator.assertDraftSaveAllowed(application);

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
    this.validator.assertSubmissionAllowed(application);

    // Kiểm tra slug trước khi đổi dữ liệu entity để lỗi trả về đúng ngữ cảnh field user vừa nhập.
    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id as string | undefined,
    );

    this.mapper.applyDto(application, dto);

    // Chỉ chặn ở thời điểm gửi duyệt; lưu nháp vẫn được phép để seller sửa từng nhóm qua nhiều lần làm việc.
    const unchangedCorrectionTargets =
      this.corrections.getUnchangedTargets(application);
    if (unchangedCorrectionTargets.length > 0) {
      throw new BadRequestException({
        message:
          "Hồ sơ chưa cập nhật đầy đủ các nội dung được yêu cầu chỉnh sửa.",
        unchangedCorrectionTargets,
      });
    }

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
    application.correctionTargets = [];
    application.correctionSnapshotHashes = {};
    application.submissionRevision = (application.submissionRevision ?? 0) + 1;

    const saved = await this.applicationRepository.save(application);

    // Kafka event gửi sau khi DB save thành công để email không thông báo một hồ sơ chưa tồn tại hoặc chưa đúng trạng thái.
    await this.events.publishSubmitted(saved);

    return this.mapper.toResponse(saved);
  }

  // Thay thế dữ liệu của hồ sơ đang pending chỉ khi người dùng hoàn tất form và bấm gửi lại; thao tác chỉnh sửa tạm không chạm DB.
  async resubmit(
    currentUser: CurrentUserContext,
    dto: SaveSellerApplicationDto,
  ): Promise<SellerApplicationResponseDto> {
    const user = this.auth.ensureAuthenticatedUser(currentUser);
    const application = await this.applicationRepository.findOne({
      where: { userId: user.userId },
    });

    if (!application) {
      throw new NotFoundException("Không tìm thấy hồ sơ người bán.");
    }

    if (application.status !== SellerApplicationStatus.PENDING_REVIEW) {
      throw new ConflictException(
        "Chỉ hồ sơ đang chờ duyệt mới có thể chỉnh sửa và gửi lại.",
      );
    }

    await this.validator.assertShopSlugAvailable(
      dto.shop?.slug,
      application.id,
    );
    this.mapper.applyDto(application, dto);
    await this.validator.assertApplicationReady(
      application,
      dto.acceptedTerms === true,
    );

    // Conditional UPDATE là hàng rào cuối: nếu admin vừa duyệt trong lúc user điền form, dữ liệu đã duyệt không bị ghi đè.
    const result = await this.applicationRepository.update(
      {
        id: application.id,
        status: SellerApplicationStatus.PENDING_REVIEW,
      },
      {
        shopName: application.shopName,
        shopSlug: application.shopSlug,
        mainCategoryId: application.mainCategoryId,
        businessModel: application.businessModel,
        shopDescription: application.shopDescription,
        logoUrl: application.logoUrl,
        profileType: application.profileType,
        legalName: application.legalName,
        citizenId: application.citizenId,
        taxCode: application.taxCode,
        representativeName: application.representativeName,
        representativeRole: application.representativeRole,
        contactPhone: application.contactPhone,
        contactEmail: application.contactEmail,
        // TypeORM yêu cầu deep-partial cho JSONB dù mapper đã tạo đúng Record; cast chỉ thu hẹp tại biên persistence, không bỏ kiểm tra kiểu toàn payload.
        verificationDocuments:
          application.verificationDocuments as QueryDeepPartialEntity<
            Record<string, unknown>
          >,
        pickupContactName: application.pickupContactName,
        pickupPhone: application.pickupPhone,
        pickupProvinceId: application.pickupProvinceId,
        pickupWardId: application.pickupWardId,
        pickupAddressLine: application.pickupAddressLine,
        bankCode: application.bankCode,
        bankName: application.bankName,
        bankAccountNumber: application.bankAccountNumber,
        bankAccountHolderName: application.bankAccountHolderName,
        bankAccountType: application.bankAccountType,
        bankBranch: application.bankBranch,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewNote: null,
        submissionRevision: (application.submissionRevision ?? 0) + 1,
      },
    );

    if (result.affected !== 1) {
      throw new ConflictException(
        "Hồ sơ vừa được xử lý. Vui lòng tải lại trang để xem trạng thái mới nhất.",
      );
    }

    const saved = await this.applicationRepository.findOne({
      where: { id: application.id },
    });

    if (!saved) {
      throw new NotFoundException("Không tìm thấy hồ sơ người bán.");
    }

    await this.events.publishSubmitted(saved);
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

    // Luôn trả hồ sơ bất kể trạng thái; validator của từng use case quyết định thao tác nào được phép.
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
