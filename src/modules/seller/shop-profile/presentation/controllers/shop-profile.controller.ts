import { Body, Controller, Get, Headers, Patch } from "@nestjs/common";
import { ShopProfileService } from "../../application/services/shop-profile.service";
import { UpdateShopProfileDto } from "../dto/update-shop-profile.dto";

@Controller("seller/shop/profile")
export class ShopProfileController {
  // Controller chỉ chuyển HTTP input sang use case; ownership và permission luôn được kiểm tra lại trong service.
  constructor(private readonly shopProfileService: ShopProfileService) {}

  // Trả hồ sơ vận hành của shop thuộc user hiện tại cùng snapshot thuế và định danh đã được che dữ liệu nhạy cảm.
  @Get()
  getMine(@Headers() headers: Record<string, unknown>) {
    const currentUser =
      this.shopProfileService.buildCurrentUserFromHeaders(headers);
    return this.shopProfileService.getMine(currentUser);
  }

  // Chỉ nhận whitelist trường công khai có thể chỉnh sửa và không cho frontend truyền ownerUserId hoặc trạng thái shop.
  @Patch()
  updateMine(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: UpdateShopProfileDto,
  ) {
    const currentUser =
      this.shopProfileService.buildCurrentUserFromHeaders(headers);
    return this.shopProfileService.updateMine(currentUser, dto);
  }
}
