import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { SellerApplicationsService } from "../../application/services/seller-applications.service";
import { ListSellerApplicationsQueryDto } from "../dto/list-seller-applications-query.dto";
import { SaveSellerApplicationDto } from "../dto/save-seller-application.dto";

@Controller("seller/applications")
export class SellerApplicationsController {
  // Controller chỉ chuyển HTTP input thành application call; toàn bộ auth và business rule nằm trong provider bên dưới.
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

  // Trả danh sách hồ sơ cho Admin Center; service kiểm tra permission từ header do API Gateway inject.
  @Get("admin")
  listForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Query() query: ListSellerApplicationsQueryDto,
  ) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.listForAdmin(currentUser, query);
  }

  // Lấy đầy đủ một hồ sơ theo id để trang chi tiết admin không phải suy luận từ dữ liệu bảng phân trang.
  @Get("admin/:id")
  getForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    const currentUser =
      this.sellerApplicationsService.buildCurrentUserFromHeaders(headers);
    return this.sellerApplicationsService.getForAdmin(currentUser, id);
  }

  // Lưu nháp từng bước; danh tính luôn lấy từ header gateway, không nhận userId do trình duyệt gửi trong body.
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
