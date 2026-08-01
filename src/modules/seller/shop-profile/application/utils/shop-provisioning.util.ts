import { InternalServerErrorException } from "@nestjs/common";
import type { DeepPartial } from "typeorm";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { Shop } from "../../../../../database/entities/shop.entity";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { ShopStatus } from "../../../../../database/enums/shop-status.enum";

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
