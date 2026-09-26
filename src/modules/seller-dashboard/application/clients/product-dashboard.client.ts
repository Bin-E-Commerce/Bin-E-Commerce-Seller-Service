// Client nội bộ đọc product/inventory snapshot; Product Service giữ quyền sở hữu dữ liệu catalog.

import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProductDashboardSnapshot {
    summary: { activeProducts: number; outOfStockProducts: number };
    topProducts: Array<{
        productId: string;
        name: string;
        thumbnailUrl: string | null;
        quantitySold: number;
        revenue: number | null;
        stock: number;
    }>;
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

    // Product dashboard là read-only và scope trực tiếp theo shopId đã resolve từ Seller Service.
    async getSnapshot(shopId: string): Promise<ProductDashboardSnapshot> {
        const response = await fetch(
            `${this.baseUrl}/api/v1/internal/products/shops/${shopId}/dashboard`,
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
