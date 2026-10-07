// Use case tổng hợp dashboard seller từ shop ownership, Order Service và Product Service.
// Service không truy cập database cross-service; mọi số liệu domain do service sở hữu trả về.

import {
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ShopStatus } from '@/database/shop-profile/enums/shop-status.enum';
import { ShopOwnershipService } from '@/modules/shop-profile/application/services/shop-ownership.service';
import { OrderDashboardClient } from '@/modules/seller-dashboard/application/clients/order-dashboard.client';
import { ProductDashboardClient } from '@/modules/seller-dashboard/application/clients/product-dashboard.client';
import {
    createDashboardDateRange,
    fillDashboardTrend,
    normalizeDashboardRange,
} from '@/modules/seller-dashboard/application/utils/dashboard-date-range.util';
import type {
    SellerDashboardRange,
    SellerDashboardSnapshot,
} from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

@Injectable()
export class SellerDashboardService {
    constructor(
        private readonly ownership: ShopOwnershipService,
        private readonly orderClient: OrderDashboardClient,
        private readonly productClient: ProductDashboardClient,
    ) {}

    // Resolve shop từ user context rồi gọi downstream song song để giảm thời gian chờ dashboard.
    async getOverview(
        ownerUserId: string | undefined,
        rangeValue?: string,
    ): Promise<SellerDashboardSnapshot> {
        if (!ownerUserId?.trim()) {
            throw new UnauthorizedException('Thiếu user context.');
        }

        const shop = await this.ownership.findOwnedShop(ownerUserId);
        if (!shop) {
            throw new NotFoundException('Shop chưa được kích hoạt.');
        }
        // Chỉ shop ACTIVE mới được đọc snapshot vận hành; shop bị khóa không được gọi downstream.
        if (shop.status !== ShopStatus.ACTIVE) {
            throw new ForbiddenException(
                'Shop chưa ở trạng thái hoạt động để xem dashboard.',
            );
        }

        const range = normalizeDashboardRange(rangeValue);
        const dateRange = createDashboardDateRange(range);
        const [orders, products] = await Promise.all([
            this.orderClient.getSnapshot(shop.id, dateRange),
            this.productClient.getSnapshot(shop.id, ownerUserId),
        ]);

        return this.toSnapshot(shop, range, dateRange, orders, products);
    }

    // Map các read model domain thành response ổn định cho frontend, không để UI tự suy luận trạng thái.
    private toSnapshot(
        shop: {
            id: string;
            name: string;
            status: string;
            logoUrl: string;
        },
        range: SellerDashboardRange,
        dateRange: ReturnType<typeof createDashboardDateRange>,
        orders: Awaited<ReturnType<OrderDashboardClient['getSnapshot']>>,
        products: Awaited<ReturnType<ProductDashboardClient['getSnapshot']>>,
    ): SellerDashboardSnapshot {
        const revenueChangePercent = this.calculateChangePercent(
            orders.current.grossRevenue,
            orders.previous.grossRevenue,
        );
        const orderChangePercent = this.calculateChangePercent(
            orders.current.orderCount,
            orders.previous.orderCount,
        );
        return {
            generatedAt: new Date().toISOString(),
            timezone: 'Asia/Ho_Chi_Minh',
            shop: {
                id: shop.id,
                name: shop.name,
                status: shop.status,
                logoUrl: shop.logoUrl?.trim() || null,
            },
            range: { ...dateRange, key: range },
            kpis: {
                grossRevenue: orders.current.grossRevenue,
                grossRevenuePreviousPeriod: orders.previous.grossRevenue,
                grossRevenueChangePercent: revenueChangePercent,
                orderCount: orders.current.orderCount,
                orderCountPreviousPeriod: orders.previous.orderCount,
                orderChangePercent,
                pendingConfirmation:
                    orders.orderStatusCounts.pendingConfirmation,
                pendingShipment: orders.orderStatusCounts.pendingShipment,
                shipping: orders.orderStatusCounts.shipping,
                pendingReturns: orders.pendingReturns,
                catalogProducts: products.summary.catalogProducts,
                activeProducts: products.summary.activeProducts,
                inStockProducts: products.summary.inStockProducts,
                stockUnits: products.summary.stockUnits,
                outOfStockProducts: products.summary.outOfStockProducts,
            },
            revenueTrend: fillDashboardTrend(orders.revenueTrend, dateRange),
            orderStatusCounts: orders.orderStatusCounts,
            latestOrders: orders.latestOrders,
            recentReturnOrders: orders.recentReturnOrders,
            recentReturnOrdersHasMore: orders.recentReturnOrdersHasMore,
            actionableOrders: orders.actionableOrders,
            actionableOrdersHasMore: orders.actionableOrdersHasMore,
            cancelledOrders: orders.cancelledOrders,
            cancelledOrdersHasMore: orders.cancelledOrdersHasMore,
            deliveredOrders: orders.deliveredOrders,
            deliveredOrdersHasMore: orders.deliveredOrdersHasMore,
            completedOrders: orders.completedOrders,
            completedOrdersHasMore: orders.completedOrdersHasMore,
            // Sản phẩm bán được chỉ đến từ Order Service trong range hiện tại; không ghép total_sold tích lũy từ catalog.
            topProducts: orders.topProducts.map((product) => ({
                ...product,
                stock: null,
            })),
            topProductsTotalCount: orders.topProductsTotalCount,
            topProductsHasMore: orders.topProductsHasMore,
        };
    }

    // Khi kỳ trước bằng 0, null chính xác hơn việc hiển thị phần trăm vô hạn hoặc 100% giả.
    private calculateChangePercent(
        current: number,
        previous: number,
    ): number | null {
        if (previous === 0) return current === 0 ? 0 : null;
        return Number((((current - previous) / previous) * 100).toFixed(1));
    }
}
