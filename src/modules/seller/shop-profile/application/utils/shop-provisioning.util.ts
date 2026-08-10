import { InternalServerErrorException } from "@nestjs/common";
import type { DeepPartial } from "typeorm";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { ShopComplianceProfile } from "../../../../../database/entities/shop-compliance-profile.entity";
import { Shop } from "../../../../../database/entities/shop.entity";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { ShopStatus } from "../../../../../database/enums/shop-status.enum";

// Bắt buộc dữ liệu provisioning phải là chuỗi có giá trị để không tạo hồ sơ pháp lý bằng placeholder hoặc chuỗi rỗng.
function requireProvisioningValue(
  value: string | null,
  fieldName: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new InternalServerErrorException(
      `Hồ sơ đã duyệt thiếu dữ liệu bắt buộc: ${fieldName}.`,
    );
  }

  return normalized;
}

// Chuyển snapshot onboarding đã duyệt thành dữ liệu shop vận hành và chặn tạo shop từ hồ sơ thiếu dữ liệu bắt buộc.
export function mapApprovedApplicationToShop(
  application: SellerApplication,
): DeepPartial<Shop> {
  const {
    shopName,
    shopSlug,
    logoUrl,
    mainCategoryId,
    businessModel,
    contactEmail,
    contactPhone,
  } = application;
  const hasRequiredData =
    application.status === SellerApplicationStatus.APPROVED &&
    shopName &&
    shopSlug &&
    logoUrl &&
    mainCategoryId &&
    businessModel &&
    contactEmail &&
    contactPhone;

  if (!hasRequiredData) {
    throw new InternalServerErrorException(
      "Hồ sơ đã duyệt chưa đủ dữ liệu để kích hoạt shop.",
    );
  }

  return {
    ownerUserId: application.userId,
    sellerApplicationId: application.id,
    sellerApplication: application,
    name: shopName,
    slug: shopSlug,
    logoUrl,
    description: application.shopDescription,
    mainCategoryId,
    businessModel,
    contactEmail,
    contactPhone,
    status: ShopStatus.ACTIVE,
    verifiedAt: application.reviewedAt ?? new Date(),
  };
}

// Chuyển snapshot pháp lý đã được admin duyệt thành hồ sơ compliance có hiệu lực, tuyệt đối không tự điền dữ liệu giả.
export function mapApprovedApplicationToComplianceProfile(
  application: SellerApplication,
  shop: Shop,
): DeepPartial<ShopComplianceProfile> {
  const requiredValues = {
    legalName: requireProvisioningValue(application.legalName, "legalName"),
    representativeName: requireProvisioningValue(
      application.representativeName,
      "representativeName",
    ),
    legalContactEmail: requireProvisioningValue(
      application.contactEmail,
      "contactEmail",
    ),
    legalContactPhone: requireProvisioningValue(
      application.contactPhone,
      "contactPhone",
    ),
    bankCode: requireProvisioningValue(application.bankCode, "bankCode"),
    bankName: requireProvisioningValue(application.bankName, "bankName"),
    bankAccountNumber: requireProvisioningValue(
      application.bankAccountNumber,
      "bankAccountNumber",
    ),
    bankAccountHolderName: requireProvisioningValue(
      application.bankAccountHolderName,
      "bankAccountHolderName",
    ),
  };

  // Loại hồ sơ quyết định định danh bắt buộc; hồ sơ cá nhân và doanh nghiệp không được thay thế ID cho nhau.
  if (
    (application.profileType === SellerProfileType.INDIVIDUAL &&
      !application.citizenId) ||
    (application.profileType === SellerProfileType.BUSINESS &&
      !application.taxCode)
  ) {
    throw new InternalServerErrorException(
      "Hồ sơ đã duyệt thiếu định danh phù hợp với loại người bán.",
    );
  }

  return {
    shopId: shop.id,
    shop,
    profileType: application.profileType,
    legalName: requiredValues.legalName,
    citizenId: application.citizenId,
    taxCode: application.taxCode,
    representativeName: requiredValues.representativeName,
    representativeRole: application.representativeRole,
    legalContactEmail: requiredValues.legalContactEmail,
    legalContactPhone: requiredValues.legalContactPhone,
    verificationDocuments: application.verificationDocuments ?? {},
    bankCode: requiredValues.bankCode,
    bankName: requiredValues.bankName,
    bankAccountNumber: requiredValues.bankAccountNumber,
    bankAccountHolderName: requiredValues.bankAccountHolderName,
    bankAccountType: application.bankAccountType,
    bankBranch: application.bankBranch,
    version: 1,
    verifiedAt: application.reviewedAt ?? shop.verifiedAt,
  };
}
