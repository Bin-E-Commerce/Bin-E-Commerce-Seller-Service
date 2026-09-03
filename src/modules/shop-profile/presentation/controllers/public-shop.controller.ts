// Public API của shop, không trả dữ liệu compliance hay thông tin liên hệ riêng tư.

import { Controller, Delete, Get, Headers, Param, Put, Query } from "@nestjs/common";
import { PublicShopService } from "../../application/services/public-shop.service";
import { ListPublicShopsQueryDto } from "../dto/list-public-shops-query.dto";

// Controller public chỉ nhận identifier/header đã được Gateway chuẩn hóa rồi chuyển vào application service.
@Controller("shops")
export class PublicShopController {
  constructor(private readonly publicShopService: PublicShopService) {}

  // Guest được xem danh sách shop đang hoạt động để chọn đúng dữ liệu nội bộ cho luồng test mua hàng.
  @Get()
  listPublicShops(@Query() query: ListPublicShopsQueryDto) {
    return this.publicShopService.listPublicShops(query);
  }

  // Guest được xem shop; x-user-id nếu có chỉ dùng để đánh dấu trạng thái đang follow.
  @Get(":identifier")
  getPublicShop(
    @Param("identifier") identifier: string,
    @Headers("x-user-id") viewerId?: string,
  ) {
    return this.publicShopService.getPublicShop(identifier, viewerId);
  }

  // Follow yêu cầu user context do Gateway xác thực, còn service vẫn kiểm tra viewerId để không tin body từ client.
  @Put(":identifier/follow")
  follow(
    @Param("identifier") identifier: string,
    @Headers("x-user-id") viewerId?: string,
  ) {
    return this.publicShopService.follow(identifier, viewerId);
  }

  // Bỏ follow có cùng semantics idempotent với follow để thao tác lặp không làm âm counter.
  @Delete(":identifier/follow")
  unfollow(
    @Param("identifier") identifier: string,
    @Headers("x-user-id") viewerId?: string,
  ) {
    return this.publicShopService.unfollow(identifier, viewerId);
  }
}
