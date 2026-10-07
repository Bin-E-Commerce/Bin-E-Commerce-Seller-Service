// Client nội bộ đọc product/inventory snapshot; Product Service giữ quyền sở hữu dữ liệu catalog.

import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProductDashboardSnapshot {
    summary: {
        catalogProducts: number;
        activeProducts: number;
        inStockProducts: number;
        stockUnits: number;
        outOfStockProducts: number;
    };
}

@Injectable()
export class ProductDashboardClient {
    private readonly baseUrl: string;
    private readonly token: string;

    constructor(config: ConfigService) {
        this.baseUrl = config.get<string>(
            'PRODUCT_SERVICE_URL',
            'http://localhost:3008',
        );
        this.token = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
    }

    // Product dashboard chỉ đọc; shopId và ownerUserId đều do Seller Service xác thực trước khi gửi qua internal token.
    async getSnapshot(
        shopId: string,
        ownerUserId: string,
    ): Promise<ProductDashboardSnapshot> {
        // Owner là identity đã được Seller Service xác thực; gửi thêm để Product Service tìm cả record legacy chưa gắn seller_shop_id.
        const query = new URLSearchParams({ ownerUserId });
        const response = await fetch(
            `${this.baseUrl}/api/v1/internal/products/shops/${shopId}/dashboard?${query}`,
            {
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.token,
                },
                signal: AbortSignal.timeout(5_000),
            },
        ).catch(() => null);

        if (!response?.ok) {
            throw new BadGatewayException(
                'Product Service chưa sẵn sàng để tải dữ liệu dashboard.',
            );
        }

        return (await response.json()) as ProductDashboardSnapshot;
    }
}
