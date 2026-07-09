import { Body, Controller, Get, Headers, Patch, Post, Query } from "@nestjs/common";
import { SellerApplicationsService } from "../../application/services/seller-applications.service";
import { ListSellerApplicationsQueryDto } from "../dto/list-seller-applications-query.dto";
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

  // Trả danh sách hồ sơ cho admin backoffice; service sẽ kiểm tra role từ header do API Gateway inject.
  @Get("admin")
  listForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Query() query: ListSellerApplicationsQueryDto,
  ) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.listForAdmin(currentUser, query);
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
