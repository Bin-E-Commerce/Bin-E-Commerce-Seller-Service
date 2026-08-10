import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Shop } from "../../../../../database/entities/shop.entity";
import { ShopProfileResponseDto } from "../../presentation/dto/shop-profile-response.dto";
import { UpdateShopProfileDto } from "../../presentation/dto/update-shop-profile.dto";
import { ShopUserContext } from "../types/shop-user-context.type";
import { ShopComplianceProfileService } from "./shop-compliance-profile.service";
import { ShopOwnershipService } from "./shop-ownership.service";
import { ShopProfileAccessService } from "./shop-profile-access.service";
import { ShopProfileChangeRequestService } from "./shop-profile-change-request.service";

@Injectable()
export class ShopProfileService {
  // Tách dữ liệu vận hành, compliance và request chờ duyệt để mỗi nhóm có vòng đời độc lập.
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
    private readonly ownership: ShopOwnershipService,
    private readonly complianceProfiles: ShopComplianceProfileService,
    private readonly changeRequests: ShopProfileChangeRequestService,
    private readonly access: ShopProfileAccessService,
  ) {}

  // Đọc shop bằng userId đã được Gateway xác thực, sau đó ghép dữ liệu compliance đang có hiệu lực và request đang chờ.
  async getMine(currentUser: ShopUserContext): Promise<ShopProfileResponseDto> {
    const user = this.access.ensureCanRead(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const [compliance, pendingChangeRequest] = await Promise.all([
      this.complianceProfiles.findByShopIdOrThrow(shop.id),
      this.changeRequests.findPendingForShop(shop.id),
    ]);

    return {
      capabilities: {
        canUpdatePublicProfile: this.access.canUpdate(user),
        canRequestSensitiveChange:
          this.access.canCreateChangeRequest(user) && !pendingChangeRequest,
      },
      pendingChangeRequest,
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
        profileType: compliance.profileType,
        legalName: compliance.legalName,
        taxCodeMasked: this.maskSensitiveValue(compliance.taxCode),
        invoiceEmail: compliance.legalContactEmail,
        payoutBankCode: compliance.bankCode,
        payoutBankName: compliance.bankName,
        payoutAccountHolder: compliance.bankAccountHolderName,
        payoutAccountNumberMasked: this.maskSensitiveValue(
          compliance.bankAccountNumber,
        ),
        payoutAccountType: compliance.bankAccountType,
        payoutBranch: compliance.bankBranch,
      },
      identity: {
        verificationStatus: "verified",
        profileType: compliance.profileType,
        legalName: compliance.legalName,
        citizenIdMasked: this.maskSensitiveValue(compliance.citizenId),
        representativeName: compliance.representativeName,
        representativeRole: compliance.representativeRole,
        contactEmail: compliance.legalContactEmail,
        contactPhone: compliance.legalContactPhone,
        documentTypes: Object.keys(compliance.verificationDocuments ?? {}),
        verifiedAt: compliance.verifiedAt,
      },
    };
  }

  // Cập nhật ngay các trường công khai; slug, ngành hàng và dữ liệu compliance không xuất hiện trong DTO này.
  async updateMine(
    currentUser: ShopUserContext,
    dto: UpdateShopProfileDto,
  ): Promise<ShopProfileResponseDto> {
    const user = this.access.ensureCanUpdate(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const normalizedPatch = this.normalizeUpdate(dto);

    if (Object.keys(normalizedPatch).length === 0) {
      throw new BadRequestException("Không có thông tin shop nào để cập nhật.");
    }

    Object.assign(shop, normalizedPatch);
    await this.shopRepository.save(shop);
    return this.getMine(user);
  }

  // Chuyển header tin cậy do Gateway truyền xuống thành context dùng chung cho use case.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): ShopUserContext {
    return this.access.buildCurrentUserFromHeaders(headers);
  }

  // Chỉ tạo patch từ field thực sự có mặt để PATCH không vô tình xóa dữ liệu hiện hành.
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

  // Chỉ lộ bốn ký tự cuối để seller nhận diện dữ liệu mà không trả toàn bộ PII ra trình duyệt.
  private maskSensitiveValue(value: string | null): string | null {
    if (!value) return null;
    if (value.length <= 4) return "*".repeat(value.length);
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }
}
