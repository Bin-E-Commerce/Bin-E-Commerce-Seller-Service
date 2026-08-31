//
// Client nội bộ đọc các product fact cần cho rule vận hành của Seller Service.
//
import { BadGatewayException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface ActiveProductCountResponse {
  shopId: string;
  activeProductCount: number;
}

@Injectable()
export class ProductCatalogClient {
  private readonly productServiceUrl: string;
  private readonly internalServiceToken: string;

  // Đọc URL và shared secret một lần để local/Docker dùng cùng contract nội bộ.
  constructor(config: ConfigService) {
    this.productServiceUrl = config.get<string>(
      "PRODUCT_SERVICE_URL",
      "http://localhost:3008",
    );
    this.internalServiceToken = config.get<string>(
      "INTERNAL_SERVICE_TOKEN",
      "dev-media-auth-internal-secret",
    );
  }

  // Đọc số sản phẩm ACTIVE trước khi cho phép xóa địa chỉ mặc định của shop.
  async getActiveProductCount(shopId: string): Promise<number> {
    const response = await fetch(
      `${this.productServiceUrl}/api/v1/internal/products/shops/${shopId}/active-count`,
      {
        headers: {
          accept: "application/json",
          "x-internal-service-token": this.internalServiceToken,
        },
        signal: AbortSignal.timeout(5_000),
      },
    ).catch(() => {
      throw new BadGatewayException(
        "Không thể xác minh sản phẩm đang bán lúc này. Vui lòng thử lại sau.",
      );
    });

    if (!response.ok) {
      throw new BadGatewayException(
        "Product Service chưa thể xác minh sản phẩm đang bán lúc này.",
      );
    }

    const payload = (await response.json()) as ActiveProductCountResponse;
    return Number.isFinite(payload.activeProductCount)
      ? payload.activeProductCount
      : 0;
  }
}
