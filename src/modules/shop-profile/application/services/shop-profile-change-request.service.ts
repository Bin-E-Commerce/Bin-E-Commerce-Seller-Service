import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, FindOptionsWhere, Repository } from "typeorm";
import { ShopComplianceProfile } from "../../../../database/shop-profile/entities/shop-compliance-profile.entity";
import { ShopProfileChangeRequest } from "../../../../database/shop-profile/entities/shop-profile-change-request.entity";
import { Shop } from "../../../../database/shop-profile/entities/shop.entity";
import { SellerProfileType } from "../../../../database/shared/enums/seller-profile-type.enum";
import { ShopProfileChangeRequestStatus } from "../../../../database/shop-profile/enums/shop-profile-change-request-status.enum";
import { ShopProfileChangeSection } from "../../../../database/shop-profile/enums/shop-profile-change-section.enum";
import {
  CreateShopProfileChangeRequestDto,
  ShopIdentityChangeDto,
  ShopPayoutChangeDto,
  ShopTaxChangeDto,
} from "../../presentation/dto/create-shop-profile-change-request.dto";
import { ListShopProfileChangeRequestsQueryDto } from "../../presentation/dto/list-shop-profile-change-requests-query.dto";
import {
  ApproveShopProfileChangeRequestDto,
  RejectShopProfileChangeRequestDto,
} from "../../presentation/dto/review-shop-profile-change-request.dto";
import {
  ListShopProfileChangeRequestsResponseDto,
  ShopProfileChangeRequestResponseDto,
} from "../../presentation/dto/shop-profile-change-request-response.dto";
import {
  ShopProfileCurrentSnapshot,
  ShopProfileRequestedChanges,
} from "../types/shop-profile-change.type";
import { ShopUserContext } from "../types/shop-user-context.type";
import { ShopOwnershipService } from "./shop-ownership.service";
import { ShopProfileAccessService } from "./shop-profile-access.service";
import { ShopProfileChangeRequestEventsService } from "./shop-profile-change-request-events.service";

@Injectable()
export class ShopProfileChangeRequestService {
  // DataSource được dùng cho transaction và pessimistic lock để hai admin không thể xử lý cùng một request đồng thời.
  constructor(
    @InjectRepository(ShopProfileChangeRequest)
    private readonly requestRepository: Repository<ShopProfileChangeRequest>,
    private readonly dataSource: DataSource,
    private readonly ownership: ShopOwnershipService,
    private readonly access: ShopProfileAccessService,
    private readonly events: ShopProfileChangeRequestEventsService,
  ) {}

  // Tạo một yêu cầu từ các field thật sự thay đổi; hồ sơ compliance hiện hành vẫn nguyên vẹn trong lúc chờ admin.
  async createMine(
    currentUser: ShopUserContext,
    dto: CreateShopProfileChangeRequestDto,
  ): Promise<ShopProfileChangeRequestResponseDto> {
    const user = this.access.ensureCanCreateChangeRequest(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);

    const createdId = await this.dataSource.transaction(async (manager) => {
      // Khóa shop làm mutex nghiệp vụ để một shop không tạo hai request pending trong cùng thời điểm.
      const lockedShop = await manager.findOne(Shop, {
        where: { id: shop.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!lockedShop) throw new NotFoundException("Không tìm thấy shop.");

      const pending = await manager.findOne(ShopProfileChangeRequest, {
        where: {
          shopId: shop.id,
          status: ShopProfileChangeRequestStatus.PENDING_REVIEW,
        },
      });
      if (pending) {
        throw new ConflictException(
          "Shop đang có một yêu cầu thay đổi chờ duyệt.",
        );
      }

      const compliance = await manager.findOne(ShopComplianceProfile, {
        where: { shopId: shop.id },
        lock: { mode: "pessimistic_read" },
      });
      if (!compliance) {
        throw new NotFoundException("Chưa có hồ sơ xác minh của shop.");
      }

      const requestedChanges = this.normalizeEffectiveChanges(dto, compliance);
      const sections = this.getSections(requestedChanges);
      if (sections.length === 0) {
        throw new BadRequestException(
          "Thông tin mới không khác hồ sơ đang có hiệu lực.",
        );
      }

      this.assertIdentityDocuments(requestedChanges, compliance.profileType);
      const request = manager.create(ShopProfileChangeRequest, {
        shopId: shop.id,
        shop: lockedShop,
        requesterUserId: user.userId,
        sections,
        currentSnapshot: this.buildCurrentSnapshot(
          requestedChanges,
          compliance,
        ) as Record<string, unknown>,
        requestedChanges: requestedChanges as Record<string, unknown>,
        baseComplianceVersion: compliance.version,
        requestNote: dto.requestNote.trim(),
        status: ShopProfileChangeRequestStatus.PENDING_REVIEW,
        reviewedBy: null,
        reviewNote: null,
        submittedAt: new Date(),
        reviewedAt: null,
      });
      const saved = await manager.save(request);
      return saved.id;
    });

    const created = await this.getOwnedRequest(user.userId, createdId);
    await this.events.publishRequested(created);
    return this.toResponse(created);
  }

  // Liệt kê yêu cầu cho Admin Center; quyền đọc được kiểm tra lại tại service ngoài guard của Gateway.
  async listForAdmin(
    currentUser: ShopUserContext,
    query: ListShopProfileChangeRequestsQueryDto,
  ): Promise<ListShopProfileChangeRequestsResponseDto> {
    this.access.ensureCanReadChangeRequests(currentUser);
    const where: FindOptionsWhere<ShopProfileChangeRequest> = {};
    if (query.status) where.status = query.status;

    const [items, totalItems] = await this.requestRepository.findAndCount({
      where,
      relations: { shop: true },
      order: { submittedAt: "DESC" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((item) => this.toResponse(item)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  // Trả chi tiết trước/sau cho admin; endpoint này chứa PII nên luôn bắt buộc permission read chuyên biệt.
  async getForAdmin(
    currentUser: ShopUserContext,
    requestId: string,
  ): Promise<ShopProfileChangeRequestResponseDto> {
    this.access.ensureCanReadChangeRequests(currentUser);
    const request = await this.findById(requestId);
    return this.toResponse(request);
  }

  // Duyệt request trong transaction, áp dụng toàn bộ field như một đơn vị nguyên tử rồi tăng version hồ sơ compliance.
  async approveForAdmin(
    currentUser: ShopUserContext,
    requestId: string,
    dto: ApproveShopProfileChangeRequestDto,
  ): Promise<ShopProfileChangeRequestResponseDto> {
    const reviewer = this.access.ensureCanApproveChangeRequest(currentUser);

    await this.dataSource.transaction(async (manager) => {
      // Chỉ khóa bảng request ở truy vấn này. Nếu nạp relation shop, TypeORM sinh LEFT JOIN ... FOR UPDATE
      // và PostgreSQL sẽ từ chối khóa phía nullable của outer join trước khi transaction được xử lý.
      const request = await manager.findOne(ShopProfileChangeRequest, {
        where: { id: requestId },
        lock: { mode: "pessimistic_write" },
      });
      this.assertPending(request);

      const compliance = await manager.findOne(ShopComplianceProfile, {
        where: { shopId: request.shopId },
        lock: { mode: "pessimistic_write" },
      });
      if (!compliance) {
        throw new NotFoundException("Chưa có hồ sơ xác minh của shop.");
      }

      // Chặn lost update: request phải được review lại nếu compliance đã thay đổi kể từ lúc seller gửi yêu cầu.
      if (request.baseComplianceVersion !== compliance.version) {
        throw new ConflictException(
          "Hồ sơ shop đã thay đổi sau khi yêu cầu được gửi. Vui lòng từ chối yêu cầu cũ và đề nghị seller gửi lại.",
        );
      }

      this.applyApprovedChanges(
        compliance,
        request.requestedChanges as ShopProfileRequestedChanges,
      );
      compliance.version += 1;
      compliance.verifiedAt = new Date();

      request.status = ShopProfileChangeRequestStatus.APPROVED;
      request.reviewedBy = reviewer.userId;
      request.reviewNote = dto.reviewNote?.trim() || null;
      request.reviewedAt = new Date();

      await manager.save(compliance);
      await manager.save(request);
    });

    // Nạp lại relation shop sau khi commit để payload notification có tên shop và không giữ entity gắn với transaction đã đóng.
    const approved = await this.findById(requestId);
    await this.events.publishApproved(approved);
    return this.toResponse(approved);
  }

  // Từ chối chỉ đóng request và giữ nguyên compliance profile, vì dữ liệu chưa duyệt tuyệt đối không được áp dụng một phần.
  async rejectForAdmin(
    currentUser: ShopUserContext,
    requestId: string,
    dto: RejectShopProfileChangeRequestDto,
  ): Promise<ShopProfileChangeRequestResponseDto> {
    const reviewer = this.access.ensureCanRejectChangeRequest(currentUser);

    await this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(ShopProfileChangeRequest, {
        where: { id: requestId },
        lock: { mode: "pessimistic_write" },
      });
      this.assertPending(request);

      request.status = ShopProfileChangeRequestStatus.REJECTED;
      request.reviewedBy = reviewer.userId;
      request.reviewNote = dto.reviewNote.trim();
      request.reviewedAt = new Date();
      await manager.save(request);
    });

    // Chỉ phát kết quả sau khi trạng thái rejected đã commit để realtime không xuất hiện trước dữ liệu bền vững.
    const rejected = await this.findById(requestId);
    await this.events.publishRejected(rejected);
    return this.toResponse(rejected);
  }

  // Trả request pending cho trang hồ sơ seller để khóa form nhạy cảm và hiển thị trạng thái đang được xử lý.
  async findPendingForShop(
    shopId: string,
  ): Promise<ShopProfileChangeRequestResponseDto | null> {
    const request = await this.requestRepository.findOne({
      where: {
        shopId,
        status: ShopProfileChangeRequestStatus.PENDING_REVIEW,
      },
      relations: { shop: true },
      order: { submittedAt: "DESC" },
    });
    return request ? this.toResponse(request) : null;
  }

  // Chuyển header đã được Gateway ký/xác thực thành context dùng chung cho controller change request.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): ShopUserContext {
    return this.access.buildCurrentUserFromHeaders(headers);
  }

  // Chỉ owner mới được đọc lại request vừa tạo; điều kiện owner nằm ngay trong query để tránh IDOR.
  private async getOwnedRequest(
    ownerUserId: string,
    requestId: string,
  ): Promise<ShopProfileChangeRequest> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId, requesterUserId: ownerUserId },
      relations: { shop: true },
    });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu.");
    return request;
  }

  // Đọc request cùng shop để mapper luôn có đủ thông tin hiển thị cho Admin Center.
  private async findById(requestId: string): Promise<ShopProfileChangeRequest> {
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
      relations: { shop: true },
    });
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu.");
    return request;
  }

  // Loại field rỗng và field giống giá trị hiện hành để request chỉ chứa đúng thay đổi admin cần xem.
  private normalizeEffectiveChanges(
    dto: CreateShopProfileChangeRequestDto,
    current: ShopComplianceProfile,
  ): ShopProfileRequestedChanges {
    const result: ShopProfileRequestedChanges = {};
    const tax = this.normalizeTaxChanges(dto.tax, current);
    const payout = this.normalizePayoutChanges(dto.payout, current);
    const identity = this.normalizeIdentityChanges(dto.identity, current);

    if (Object.keys(tax).length > 0) result.tax = tax;
    if (Object.keys(payout).length > 0) result.payout = payout;
    if (Object.keys(identity).length > 0) result.identity = identity;
    return result;
  }

  // Chuẩn hóa nhóm thuế và so sánh với dữ liệu đang có hiệu lực.
  private normalizeTaxChanges(
    dto: ShopTaxChangeDto | undefined,
    current: ShopComplianceProfile,
  ): NonNullable<ShopProfileRequestedChanges["tax"]> {
    if (!dto) return {};
    const result: NonNullable<ShopProfileRequestedChanges["tax"]> = {};
    this.assignChangedString(
      result,
      "legalName",
      dto.legalName,
      current.legalName,
    );
    this.assignChangedString(result, "taxCode", dto.taxCode, current.taxCode);
    this.assignChangedString(
      result,
      "invoiceEmail",
      dto.invoiceEmail?.toLowerCase(),
      current.legalContactEmail,
    );
    return result;
  }

  // Chuẩn hóa nhóm tài khoản nhận tiền và loại giá trị không thay đổi.
  private normalizePayoutChanges(
    dto: ShopPayoutChangeDto | undefined,
    current: ShopComplianceProfile,
  ): NonNullable<ShopProfileRequestedChanges["payout"]> {
    if (!dto) return {};
    const result: NonNullable<ShopProfileRequestedChanges["payout"]> = {};
    this.assignChangedString(
      result,
      "bankCode",
      dto.bankCode,
      current.bankCode,
    );
    this.assignChangedString(
      result,
      "bankName",
      dto.bankName,
      current.bankName,
    );
    this.assignChangedString(
      result,
      "accountNumber",
      dto.accountNumber,
      current.bankAccountNumber,
    );
    this.assignChangedString(
      result,
      "accountHolderName",
      dto.accountHolderName,
      current.bankAccountHolderName,
    );
    if (dto.accountType && dto.accountType !== current.bankAccountType) {
      result.accountType = dto.accountType;
    }
    this.assignChangedString(result, "branch", dto.branch, current.bankBranch);
    return result;
  }

  // Chuẩn hóa nhóm định danh; giấy tờ được so sánh theo JSON vì mỗi loại chứa asset metadata riêng.
  private normalizeIdentityChanges(
    dto: ShopIdentityChangeDto | undefined,
    current: ShopComplianceProfile,
  ): NonNullable<ShopProfileRequestedChanges["identity"]> {
    if (!dto) return {};
    const result: NonNullable<ShopProfileRequestedChanges["identity"]> = {};
    this.assignChangedString(
      result,
      "legalName",
      dto.legalName,
      current.legalName,
    );
    this.assignChangedString(
      result,
      "citizenId",
      dto.citizenId,
      current.citizenId,
    );
    this.assignChangedString(
      result,
      "representativeName",
      dto.representativeName,
      current.representativeName,
    );
    this.assignChangedString(
      result,
      "representativeRole",
      dto.representativeRole,
      current.representativeRole,
    );
    this.assignChangedString(
      result,
      "contactEmail",
      dto.contactEmail?.toLowerCase(),
      current.legalContactEmail,
    );
    this.assignChangedString(
      result,
      "contactPhone",
      dto.contactPhone,
      current.legalContactPhone,
    );
    if (
      dto.documents &&
      JSON.stringify(dto.documents) !==
        JSON.stringify(current.verificationDocuments)
    ) {
      result.documents = dto.documents;
    }
    return result;
  }

  // Gán chuỗi đã trim khi khác giá trị hiện hành; field undefined không được hiểu là yêu cầu xóa dữ liệu.
  private assignChangedString<T extends object, K extends keyof T>(
    target: T,
    key: K,
    incoming: string | undefined,
    current: string | null,
  ): void {
    if (incoming === undefined) return;
    const normalized = incoming.trim();
    if (normalized !== (current ?? "")) {
      target[key] = (normalized || null) as T[K];
    }
  }

  // Suy ra section từ payload đã loại field trùng để filter và hiển thị trạng thái chính xác.
  private getSections(
    changes: ShopProfileRequestedChanges,
  ): ShopProfileChangeSection[] {
    const sections: ShopProfileChangeSection[] = [];
    if (changes.tax) sections.push(ShopProfileChangeSection.TAX);
    if (changes.payout) sections.push(ShopProfileChangeSection.PAYOUT);
    if (changes.identity) sections.push(ShopProfileChangeSection.IDENTITY);
    return sections;
  }

  // Bắt buộc nộp đủ bộ chứng từ mới khi thay đổi định danh để admin không duyệt dữ liệu chỉ dựa trên text tự khai.
  private assertIdentityDocuments(
    changes: ShopProfileRequestedChanges,
    profileType: SellerProfileType,
  ): void {
    if (!changes.identity) return;
    const documents = changes.identity.documents;
    const requiredKeys =
      profileType === SellerProfileType.BUSINESS
        ? ["businessLicense", "representativeDocument"]
        : ["citizenIdFront", "citizenIdBack"];
    const missing = requiredKeys.filter(
      (key) => !this.getDocumentUrl(documents, key),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        "Thay đổi định danh cần tải lại đầy đủ giấy tờ xác minh.",
      );
    }
  }

  // Chỉ xem object có URL là tài liệu hợp lệ; metadata tùy ý không thể vượt qua rule chứng từ.
  private getDocumentUrl(
    documents: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const document = documents?.[key];
    if (!document || typeof document !== "object") return null;
    const url = (document as Record<string, unknown>).url;
    return typeof url === "string" && url.trim() ? url : null;
  }

  // Chụp đúng giá trị cũ của từng field được yêu cầu thay đổi để admin có bản so sánh bất biến.
  private buildCurrentSnapshot(
    changes: ShopProfileRequestedChanges,
    current: ShopComplianceProfile,
  ): ShopProfileCurrentSnapshot {
    const snapshot: ShopProfileCurrentSnapshot = {};
    if (changes.tax) {
      snapshot.tax = this.pickCurrentValues(changes.tax, {
        legalName: current.legalName,
        taxCode: current.taxCode,
        invoiceEmail: current.legalContactEmail,
      });
    }
    if (changes.payout) {
      snapshot.payout = this.pickCurrentValues(changes.payout, {
        bankCode: current.bankCode,
        bankName: current.bankName,
        accountNumber: current.bankAccountNumber,
        accountHolderName: current.bankAccountHolderName,
        accountType: current.bankAccountType,
        branch: current.bankBranch,
      });
    }
    if (changes.identity) {
      snapshot.identity = this.pickCurrentValues(changes.identity, {
        legalName: current.legalName,
        citizenId: current.citizenId,
        representativeName: current.representativeName,
        representativeRole: current.representativeRole,
        contactEmail: current.legalContactEmail,
        contactPhone: current.legalContactPhone,
        documents: current.verificationDocuments,
      });
    }
    return snapshot;
  }

  // Chỉ lấy các key xuất hiện trong changes để snapshot không sao chép thừa PII không liên quan đến quyết định duyệt.
  private pickCurrentValues<T extends object>(changes: T, current: T): T {
    return Object.keys(changes).reduce<Partial<T>>((result, key) => {
      const typedKey = key as keyof T;
      result[typedKey] = current[typedKey];
      return result;
    }, {}) as T;
  }

  // Áp dụng từng section đã được duyệt vào compliance profile; không đụng SellerApplication lịch sử.
  private applyApprovedChanges(
    profile: ShopComplianceProfile,
    changes: ShopProfileRequestedChanges,
  ): void {
    if (changes.tax?.legalName !== undefined)
      profile.legalName = changes.tax.legalName;
    if (changes.tax?.taxCode !== undefined)
      profile.taxCode = changes.tax.taxCode;
    if (changes.tax?.invoiceEmail !== undefined) {
      profile.legalContactEmail = changes.tax.invoiceEmail;
    }
    if (changes.payout?.bankCode !== undefined)
      profile.bankCode = changes.payout.bankCode;
    if (changes.payout?.bankName !== undefined)
      profile.bankName = changes.payout.bankName;
    if (changes.payout?.accountNumber !== undefined) {
      profile.bankAccountNumber = changes.payout.accountNumber;
    }
    if (changes.payout?.accountHolderName !== undefined) {
      profile.bankAccountHolderName = changes.payout.accountHolderName;
    }
    if (changes.payout?.accountType !== undefined) {
      profile.bankAccountType = changes.payout.accountType;
    }
    if (changes.payout?.branch !== undefined)
      profile.bankBranch = changes.payout.branch;
    if (changes.identity?.legalName !== undefined)
      profile.legalName = changes.identity.legalName;
    if (changes.identity?.citizenId !== undefined)
      profile.citizenId = changes.identity.citizenId;
    if (changes.identity?.representativeName !== undefined) {
      profile.representativeName = changes.identity.representativeName;
    }
    if (changes.identity?.representativeRole !== undefined) {
      profile.representativeRole = changes.identity.representativeRole;
    }
    if (changes.identity?.contactEmail !== undefined) {
      profile.legalContactEmail = changes.identity.contactEmail;
    }
    if (changes.identity?.contactPhone !== undefined) {
      profile.legalContactPhone = changes.identity.contactPhone;
    }
    if (changes.identity?.documents !== undefined) {
      profile.verificationDocuments = changes.identity.documents;
    }
  }

  // Chặn xử lý lại request đã có quyết định để thao tác admin có tính idempotent và không ghi đè audit cũ.
  private assertPending(
    request: ShopProfileChangeRequest | null,
  ): asserts request is ShopProfileChangeRequest {
    if (!request) throw new NotFoundException("Không tìm thấy yêu cầu.");
    if (request.status !== ShopProfileChangeRequestStatus.PENDING_REVIEW) {
      throw new ConflictException("Yêu cầu này đã được xử lý.");
    }
  }

  // Mapper response giữ nguyên snapshot cho admin/seller owner và tránh trả TypeORM relation thừa ra ngoài API.
  private toResponse(
    request: ShopProfileChangeRequest,
  ): ShopProfileChangeRequestResponseDto {
    return {
      id: request.id,
      shop: {
        id: request.shop.id,
        name: request.shop.name,
        slug: request.shop.slug,
        logoUrl: request.shop.logoUrl,
      },
      requesterUserId: request.requesterUserId,
      sections: request.sections,
      currentSnapshot: request.currentSnapshot as ShopProfileCurrentSnapshot,
      requestedChanges: request.requestedChanges as ShopProfileRequestedChanges,
      baseComplianceVersion: request.baseComplianceVersion,
      requestNote: request.requestNote,
      status: request.status,
      reviewedBy: request.reviewedBy,
      reviewNote: request.reviewNote,
      submittedAt: request.submittedAt,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}
