// Contract public cho màn hình khám phá shop nội bộ.
// Response chỉ chứa dữ liệu nhận diện công khai và metric an toàn, không lộ email, phone hoặc compliance.

import { ShopStatus } from "../../../../database/shop-profile/enums/shop-status.enum";

export interface PublicShopListItemDto {
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
}

export interface PublicShopListResponseDto {
  items: PublicShopListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
