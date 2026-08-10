import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ShopProfileChangeRequestService } from "../../application/services/shop-profile-change-request.service";
import { CreateShopProfileChangeRequestDto } from "../dto/create-shop-profile-change-request.dto";
import { ListShopProfileChangeRequestsQueryDto } from "../dto/list-shop-profile-change-requests-query.dto";
import {
  ApproveShopProfileChangeRequestDto,
  RejectShopProfileChangeRequestDto,
} from "../dto/review-shop-profile-change-request.dto";

@Controller()
export class ShopProfileChangeRequestController {
  // Controller chỉ ánh xạ HTTP sang use case; service vẫn kiểm tra lại permission và ownership.
  constructor(
    private readonly changeRequests: ShopProfileChangeRequestService,
  ) {}

  // Seller gửi thay đổi nhạy cảm cho chính shop được suy ra từ phiên đăng nhập.
  @Post("seller/shop/profile/change-requests")
  createMine(
    @Headers() headers: Record<string, unknown>,
    @Body() dto: CreateShopProfileChangeRequestDto,
  ) {
    return this.changeRequests.createMine(
      this.changeRequests.buildCurrentUserFromHeaders(headers),
      dto,
    );
  }

  // Admin đọc danh sách request theo trạng thái để xử lý theo hàng đợi.
  @Get("seller/shop/profile/change-requests/admin")
  listForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Query() query: ListShopProfileChangeRequestsQueryDto,
  ) {
    return this.changeRequests.listForAdmin(
      this.changeRequests.buildCurrentUserFromHeaders(headers),
      query,
    );
  }

  // Admin đọc snapshot trước/sau của một request trước khi ra quyết định.
  @Get("seller/shop/profile/change-requests/admin/:requestId")
  getForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Param("requestId") requestId: string,
  ) {
    return this.changeRequests.getForAdmin(
      this.changeRequests.buildCurrentUserFromHeaders(headers),
      requestId,
    );
  }

  // Duyệt toàn bộ request theo transaction để không áp dụng dở dang dữ liệu nhạy cảm.
  @Post("seller/shop/profile/change-requests/admin/:requestId/approve")
  approveForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Param("requestId") requestId: string,
    @Body() dto: ApproveShopProfileChangeRequestDto,
  ) {
    return this.changeRequests.approveForAdmin(
      this.changeRequests.buildCurrentUserFromHeaders(headers),
      requestId,
      dto,
    );
  }

  // Từ chối request với lý do bắt buộc và giữ nguyên hồ sơ đang có hiệu lực.
  @Post("seller/shop/profile/change-requests/admin/:requestId/reject")
  rejectForAdmin(
    @Headers() headers: Record<string, unknown>,
    @Param("requestId") requestId: string,
    @Body() dto: RejectShopProfileChangeRequestDto,
  ) {
    return this.changeRequests.rejectForAdmin(
      this.changeRequests.buildCurrentUserFromHeaders(headers),
      requestId,
      dto,
    );
  }
}
