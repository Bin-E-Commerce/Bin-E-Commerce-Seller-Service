import { Body, Controller, Get, Headers, Patch, Post } from "@nestjs/common";
import { SellerApplicationsService } from "../services/seller-applications.service";
import { SaveSellerApplicationDto } from "../dto/save-seller-application.dto";

@Controller("seller/applications")
export class SellerApplicationsController {
  constructor(
    private readonly sellerApplicationsService: SellerApplicationsService,
  ) {}

  // Lấy hồ sơ seller của user đang đăng nhập để FE khôi phục nháp hoặc hiển thị trạng thái chờ duyệt.
  @Get("me")
  getMine(@Headers() headers: Record<string, unknown>) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.getMyApplication(currentUser);
  }

  // Lưu nháp từng bước; route này vẫn cần JWT qua API Gateway nên anonymous user không đi tới đây.
  @Patch("me")
  saveDraft(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: SaveSellerApplicationDto,
  ) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.saveDraft(currentUser, dto);
  }

  // Gửi hồ sơ duyệt và phát Kafka event để notification-service gửi email thông báo cho user.
  @Post("submit")
  submit(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: SaveSellerApplicationDto,
  ) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.submit(currentUser, dto);
  }
}
