// Client nội bộ đọc order snapshot; không chứa logic nghiệp vụ tính doanh thu.

import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerDashboardDateRange } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

export interface OrderDashboardSnapshot {
    current: { grossRevenue: number; orderCount: number };
    previous: { grossRevenue: number; orderCount: number };
    revenueTrend: Array<{
        date: string;
        grossRevenue: number;
        orderCount: number;
    }>;
    orderStatusCounts: {
        all: number;
        pendingConfirmation: number;
        pendingShipment: number;
        shipping: number;
        delivered: number;
        completed: number;
        cancelled: number;
        returnRefund: number;
    };
    pendingReturns: number;
    latestOrders: Array<{
        id: string;
        orderNumber: string;
        status: string;
        fulfillmentStatus: string;
        grossAmount: number;
        itemCount: number;
        createdAt: string;
    }>;
    topProducts: Array<{
        productId: string;
        name: string;
        thumbnailUrl: string | null;
        quantitySold: number;
        revenue: number;
    }>;
}

@Injectable()
export class OrderDashboardClient {
    private readonly baseUrl: string;
    private readonly token: string;

    constructor(config: ConfigService) {
        this.baseUrl = config.get<string>(
            'ORDER_SERVICE_URL',
            'http://localhost:3011',
        );
        this.token = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
    }

    // Gọi Order Service bằng shared token và fail fast khi downstream không sẵn sàng.
    async getSnapshot(
        shopId: string,
        range: SellerDashboardDateRange,
    ): Promise<OrderDashboardSnapshot> {
        const params = new URLSearchParams({
            shopId,
            from: range.from,
            to: range.to,
            previousFrom: range.previousFrom,
            previousTo: range.previousTo,
        });

        const response = await fetch(
            `${this.baseUrl}/api/v1/internal/orders/seller-dashboard?${params}`,
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
                'Order Service chưa sẵn sàng để tải dữ liệu dashboard.',
            );
        }

        return (await response.json()) as OrderDashboardSnapshot;
    }
}
