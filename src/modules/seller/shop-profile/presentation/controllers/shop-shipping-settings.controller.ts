// Controller cho trang Thiết lập giao nhận; mọi shop scope đều lấy từ header JWT do Gateway forward.
import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ShopShippingSettingsService } from "../../application/services/shop-shipping-settings.service";
import { SavePickupAddressDto, UpdateShopShippingSettingsDto } from "../dto/shop-shipping.dto";

// API Seller không nhận shopId trong URL/body để tránh giả mạo scope.
@Controller("seller/shipping")
export class ShopShippingSettingsController {
  constructor(private readonly service: ShopShippingSettingsService) {}

  // Đọc settings và danh sách kho của shop hiện tại.
  @Get("settings")
  getSettings(@Headers() headers: Record<string, unknown>) {
    return this.service.getMine(this.context(headers));
  }

  // Cập nhật cấu hình vận hành của shop hiện tại.
  @Patch("settings")
  updateSettings(@Headers() headers: Record<string, unknown>, @Body() dto: UpdateShopShippingSettingsDto) {
    return this.service.updateSettings(this.context(headers), dto);
  }

  // Thêm địa chỉ lấy hàng theo cây địa giới hiện tại: tỉnh -> phường/xã hoặc tỉnh -> quận/huyện -> phường/xã.
  @Post("pickup-addresses")
  createAddress(@Headers() headers: Record<string, unknown>, @Body() dto: SavePickupAddressDto) {
    return this.service.createAddress(this.context(headers), dto);
  }

  // Cập nhật địa chỉ chỉ khi địa chỉ đó thuộc shop resolve từ user.
  @Patch("pickup-addresses/:id")
  updateAddress(@Headers() headers: Record<string, unknown>, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: SavePickupAddressDto) {
    return this.service.updateAddress(this.context(headers), id, dto);
  }

  // Chọn địa chỉ mặc định dùng để quote và tạo shipment mới.
  @Post("pickup-addresses/:id/default")
  setDefault(@Headers() headers: Record<string, unknown>, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.setDefault(this.context(headers), id);
  }

  // Xóa địa chỉ không dùng; địa chỉ mặc định đang phục vụ sản phẩm ACTIVE phải được thay thế trước.
  @Delete("pickup-addresses/:id")
  deleteAddress(@Headers() headers: Record<string, unknown>, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.deleteAddress(this.context(headers), id);
  }

  // Chuẩn hóa context từ header do Gateway xác thực.
  private context(headers: Record<string, unknown>) {
    return {
      userId: this.value(headers, "x-user-id"),
      email: this.value(headers, "x-user-email"),
      permissions: this.value(headers, "x-user-permissions").split(",").map((item) => item.trim()).filter(Boolean),
    };
  }

  // Đọc header an toàn trong cả Express string và string[].
  private value(headers: Record<string, unknown>, key: string): string {
    const value = headers[key];
    return Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
  }
}
