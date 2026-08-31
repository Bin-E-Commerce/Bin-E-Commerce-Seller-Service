//
// Internal API cho các service tin cậy đọc context giao nhận của shop.
//
import { Controller, Get, Headers, Param, ParseUUIDPipe, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ShopShippingSettingsService } from "../../application/services/shop-shipping-settings.service";

// Route nội bộ chỉ đọc địa chỉ mặc định hoặc readiness theo shopId đã được upstream xác định.
@Controller("internal/seller/shops")
export class InternalShopShippingController {
  constructor(private readonly service: ShopShippingSettingsService, private readonly config: ConfigService) {}

  // Trả pickup address cần cho quote; không trả token/provider credential.
  @Get(":shopId/pickup-address")
  getPickup(@Param("shopId", new ParseUUIDPipe()) shopId: string, @Headers("x-internal-service-token") token: string) {
    this.assertInternalToken(token);
    return this.service.getDefaultForShop(shopId);
  }

  // Product Service dùng readiness trước khi tạo hoặc bật sản phẩm để seller không nhận đơn khi chưa có kho hợp lệ.
  @Get(":shopId/shipping-readiness")
  getShippingReadiness(
    @Param("shopId", new ParseUUIDPipe()) shopId: string,
    @Headers("x-internal-service-token") token: string,
  ) {
    this.assertInternalToken(token);
    return this.service.getReadinessForShop(shopId);
  }

  // Gom kiểm tra shared secret vào một chỗ để mọi internal route có cùng hành vi bảo mật.
  private assertInternalToken(token: string): void {
    const expected = this.config.get<string>("INTERNAL_SERVICE_TOKEN", "dev-media-auth-internal-secret");
    if (!expected || token !== expected) throw new UnauthorizedException("Invalid internal service token.");
  }
}
