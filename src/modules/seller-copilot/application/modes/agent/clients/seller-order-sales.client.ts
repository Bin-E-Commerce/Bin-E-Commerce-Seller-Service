// Client đọc số bán theo biến thể từ Order Service; lỗi upstream không được chuyển thành “chưa bán”.
import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface SellerVariantSalesRow {
    variantId: string;
    quantitySold: number;
}

// Chỉ gọi endpoint nội bộ bằng shop/variant IDs đã lấy từ Product Service và service token cấu hình máy chủ.
@Injectable()
export class SellerOrderSalesClient {
    private readonly orderServiceUrl: string;
    private readonly internalServiceToken: string;

    // Dùng cấu hình server-side, không cho phép browser chọn service hoặc gửi credential nội bộ.
    constructor(config: ConfigService) {
        this.orderServiceUrl = config.get<string>(
            'ORDER_SERVICE_URL',
            'http://localhost:3011',
        );
        this.internalServiceToken = config.get<string>(
            'INTERNAL_SERVICE_TOKEN',
            '',
        );
    }

    // Order Service giới hạn mỗi request 100 IDs; chỉ trả map sau HTTP thành công để caller mới được coi SKU vắng mặt là 0.
    async getVariantSales(input: {
        shopId: string;
        variantIds: string[];
        from: Date;
        to: Date;
    }): Promise<Map<string, number>> {
        if (input.variantIds.length === 0) return new Map();
        if (input.variantIds.length > 100) {
            throw new BadGatewayException(
                'Truy vấn số bán vượt giới hạn biến thể mỗi lượt.',
            );
        }
        const query = new URLSearchParams({
            shopId: input.shopId,
            variantIds: input.variantIds.join(','),
            from: input.from.toISOString(),
            to: input.to.toISOString(),
        });
        const response = await fetch(
            `${this.orderServiceUrl}/api/v1/internal/orders/seller-variant-sales?${query}`,
            {
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.internalServiceToken,
                },
                signal: AbortSignal.timeout(8_000),
            },
        ).catch(() => null);
        if (!response?.ok) {
            throw new BadGatewayException(
                'Order Service chưa thể thống kê lượt bán theo biến thể.',
            );
        }
        const rows = (await response.json()) as SellerVariantSalesRow[];
        if (
            !Array.isArray(rows) ||
            rows.some(
                (row) =>
                    !input.variantIds.includes(row.variantId) ||
                    !Number.isSafeInteger(row.quantitySold) ||
                    row.quantitySold < 0,
            )
        ) {
            throw new BadGatewayException(
                'Order Service trả dữ liệu số bán không hợp lệ.',
            );
        }
        return new Map(rows.map((row) => [row.variantId, row.quantitySold]));
    }
}
