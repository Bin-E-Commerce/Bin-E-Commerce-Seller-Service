// Contract an toàn cho trang shop public.
// DTO này cố ý không chứa email, phone, compliance hoặc địa chỉ đầy đủ của shop.

import { ShopStatus } from "../../../../database/shop-profile/enums/shop-status.enum";

// DTO giới hạn dữ liệu được phép công khai của một shop.
export interface PublicShopResponseDto {
  shop: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string;
    description: string | null;
    mainCategoryId: string;
    status: ShopStatus;
    createdAt: Date;
    location: {
      province: string | null;
      district: string | null;
    };
  };
  stats: {
    followerCount: number;
    followingCount: number;
  };
  activity: {
    isOnline: boolean;
    lastActiveAt: Date | null;
  };
  isFollowing: boolean;
}
