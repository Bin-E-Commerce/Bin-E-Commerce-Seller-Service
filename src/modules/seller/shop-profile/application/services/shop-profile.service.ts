import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { Shop } from "../../../../../database/entities/shop.entity";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { ShopProfileResponseDto } from "../../presentation/dto/shop-profile-response.dto";
import { UpdateShopProfileDto } from "../../presentation/dto/update-shop-profile.dto";
import { ShopUserContext } from "../types/shop-user-context.type";
import { mapApprovedApplicationToShop } from "../utils/shop-provisioning.util";
import { ShopProfileAccessService } from "./shop-profile-access.service";

@Injectable()
export class ShopProfileService {
  // Shop và hồ sơ xét duyệt được đọc từ hai repository riêng để dữ liệu công khai không làm thay đổi lịch sử pháp lý.
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    private readonly access: ShopProfileAccessService,
  ) {}

  // Lấy hồ sơ shop theo userId tin cậy; dữ liệu cũ đã được duyệt sẽ được tạo shop idempotent ở lần đọc đầu tiên.
  async getMine(currentUser: ShopUserContext): Promise<ShopProfileResponseDto> {
    const user = this.access.ensureCanRead(currentUser);
    const shop = await this.findOrProvisionShop(user.userId);
    return this.toResponse(shop, this.access.canUpdate(user));
  }

  // Cập nhật duy nhất các trường hồ sơ công khai; slug, ngành hàng và dữ liệu pháp lý phải đi qua quy trình duyệt riêng.
  async updateMine(
    currentUser: ShopUserContext,
    dto: UpdateShopProfileDto,
  ): Promise<ShopProfileResponseDto> {
    const user = this.access.ensureCanUpdate(currentUser);
    const shop = await this.findOrProvisionShop(user.userId);
    const normalizedPatch = this.normalizeUpdate(dto);

    if (Object.keys(normalizedPatch).length === 0) {
      throw new BadRequestException("Không có thông tin shop nào để cập nhật.");
    }

    Object.assign(shop, normalizedPatch);
    const saved = await this.shopRepository.save(shop);
    return this.toResponse(saved, true);
  }

  // Chuyển header HTTP thành context ứng dụng để controller không phải biết chi tiết cách gateway truyền danh tính.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): ShopUserContext {
    return this.access.buildCurrentUserFromHeaders(headers);
  }

  // Ưu tiên shop vận hành đã tồn tại; fallback từ hồ sơ approved giúp nâng cấp dữ liệu cũ mà không cần script thủ công.
  private async findOrProvisionShop(ownerUserId: string): Promise<Shop> {
    const existing = await this.shopRepository.findOne({
      where: { ownerUserId },
      relations: { sellerApplication: true },
    });
    if (existing) return existing;

    const approvedApplication = await this.applicationRepository.findOne({
      where: {
        userId: ownerUserId,
        status: SellerApplicationStatus.APPROVED,
      },
    });

    if (!approvedApplication) {
      throw new NotFoundException(
        "Shop chưa được kích hoạt hoặc hồ sơ người bán chưa được duyệt.",
      );
    }

    try {
      const created = this.shopRepository.create(
        mapApprovedApplicationToShop(approvedApplication),
      );
      return await this.shopRepository.save(created);
    } catch (error) {
      // Hai request đầu tiên có thể cùng tạo shop; unique owner_user_id bảo đảm chỉ một bản ghi thắng.
      if (this.isUniqueViolation(error)) {
        const concurrentShop = await this.shopRepository.findOne({
          where: { ownerUserId },
          relations: { sellerApplication: true },
        });
        if (concurrentShop) return concurrentShop;
      }

      throw error;
    }
  }

  // Chuẩn hóa khoảng trắng và chỉ đưa field thực sự có mặt vào patch để PATCH không xóa nhầm dữ liệu cũ.
  private normalizeUpdate(dto: UpdateShopProfileDto): Partial<Shop> {
    const patch: Partial<Shop> = {};

    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.description !== undefined) {
      patch.description = dto.description.trim() || null;
    }
    if (dto.logoUrl !== undefined) patch.logoUrl = dto.logoUrl.trim();
    if (dto.contactEmail !== undefined) {
      patch.contactEmail = dto.contactEmail.trim().toLowerCase();
    }
    if (dto.contactPhone !== undefined) {
      patch.contactPhone = dto.contactPhone.trim();
    }

    return patch;
  }

  // Trả dữ liệu theo ba nhóm UI và che định danh/tài khoản ngân hàng trước khi rời seller-service.
  private toResponse(
    shop: Shop,
    canUpdatePublicProfile: boolean,
  ): ShopProfileResponseDto {
    const application = shop.sellerApplication;

    return {
      capabilities: {
        canUpdatePublicProfile,
      },
      shop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        logoUrl: shop.logoUrl,
        description: shop.description,
        mainCategoryId: shop.mainCategoryId,
        businessModel: shop.businessModel,
        contactEmail: shop.contactEmail,
        contactPhone: shop.contactPhone,
        status: shop.status,
        verifiedAt: shop.verifiedAt,
        createdAt: shop.createdAt,
        updatedAt: shop.updatedAt,
      },
      tax: {
        profileType: application.profileType,
        legalName: application.legalName,
        taxCodeMasked: this.maskSensitiveValue(application.taxCode),
        invoiceEmail: application.contactEmail,
        payoutBankName: application.bankName,
        payoutAccountHolder: application.bankAccountHolderName,
        payoutAccountNumberMasked: this.maskSensitiveValue(
          application.bankAccountNumber,
        ),
        payoutAccountType: application.bankAccountType,
      },
      identity: {
        verificationStatus: "verified",
        profileType: application.profileType,
        legalName: application.legalName,
        citizenIdMasked: this.maskSensitiveValue(application.citizenId),
        representativeName: application.representativeName,
        representativeRole: application.representativeRole,
        contactEmail: application.contactEmail,
        contactPhone: application.contactPhone,
        documentTypes: Object.keys(application.verificationDocuments ?? {}),
        verifiedAt: shop.verifiedAt,
      },
    };
  }

  // Chỉ lộ bốn ký tự cuối để seller nhận diện dữ liệu mà không làm rò rỉ toàn bộ thông tin nhạy cảm trên màn hình.
  private maskSensitiveValue(value: string | null): string | null {
    if (!value) return null;
    if (value.length <= 4) return "*".repeat(value.length);
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }

  // Nhận diện đúng mã unique violation của PostgreSQL để xử lý race condition tạo shop mà không nuốt lỗi DB khác.
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === "23505";
  }
}
