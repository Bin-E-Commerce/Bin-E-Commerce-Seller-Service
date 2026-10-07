// Unit test bảo vệ ownership scope và phép ghép snapshot trước khi dữ liệu được trả ra Gateway.

import {
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ShopStatus } from '@/database/shop-profile/enums/shop-status.enum';
import { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';

describe('SellerDashboardService', () => {
    const ownership = {
        findOwnedShop: jest.fn(),
    };
    const orderClient = {
        getSnapshot: jest.fn(),
    };
    const productClient = {
        getSnapshot: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Không có user context phải bị từ chối trước khi gọi ownership hoặc downstream.
    it('rejects a missing owner context', async () => {
        const service = new SellerDashboardService(
            ownership as never,
            orderClient as never,
            productClient as never,
        );

        await expect(service.getOverview(undefined)).rejects.toBeInstanceOf(
            UnauthorizedException,
        );
        expect(ownership.findOwnedShop).not.toHaveBeenCalled();
    });

    // Shop không thuộc user hiện tại không được phép tạo snapshot hoặc gọi sang service khác.
    it('rejects a user without an owned shop', async () => {
        ownership.findOwnedShop.mockResolvedValue(null);
        const service = new SellerDashboardService(
            ownership as never,
            orderClient as never,
            productClient as never,
        );

        await expect(service.getOverview('owner-1')).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(orderClient.getSnapshot).not.toHaveBeenCalled();
        expect(productClient.getSnapshot).not.toHaveBeenCalled();
    });

    // Shop bị tạm dừng không được gọi Order/Product Service để tránh lộ snapshot vận hành.
    it('rejects a non-active shop before loading dashboard data', async () => {
        // Arrange
        ownership.findOwnedShop.mockResolvedValue({
            id: 'shop-1',
            status: ShopStatus.SUSPENDED,
        });
        const target = new SellerDashboardService(
            ownership as never,
            orderClient as never,
            productClient as never,
        );

        // Act & Assert
        await expect(target.getOverview('owner-1')).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        expect(orderClient.getSnapshot).not.toHaveBeenCalled();
        expect(productClient.getSnapshot).not.toHaveBeenCalled();
    });

    // Snapshot phải ghép đúng KPI và trend mà không dựng metric shop giả.
    it('merges scoped downstream snapshots into one response', async () => {
        ownership.findOwnedShop.mockResolvedValue({
            id: 'shop-1',
            name: 'Shop Một',
            status: ShopStatus.ACTIVE,
            logoUrl: '',
        });
        orderClient.getSnapshot.mockResolvedValue({
            current: { grossRevenue: 1200000, orderCount: 3 },
            previous: { grossRevenue: 1000000, orderCount: 2 },
            revenueTrend: [
                { date: '2026-09-26', grossRevenue: 1200000, orderCount: 3 },
            ],
            orderStatusCounts: {
                all: 3,
                pendingConfirmation: 1,
                pendingShipment: 1,
                shipping: 1,
                delivered: 0,
                completed: 0,
                cancelled: 0,
                returnRefund: 0,
            },
            pendingReturns: 2,
            latestOrders: [],
            recentReturnOrders: [],
            actionableOrders: [],
            actionableOrdersHasMore: false,
            cancelledOrders: [],
            cancelledOrdersHasMore: false,
            deliveredOrders: [],
            deliveredOrdersHasMore: false,
            completedOrders: [],
            completedOrdersHasMore: false,
            topProducts: [],
            topProductsTotalCount: 0,
            topProductsHasMore: false,
        });
        productClient.getSnapshot.mockResolvedValue({
            summary: {
                catalogProducts: 6,
                activeProducts: 4,
                inStockProducts: 3,
                stockUnits: 25,
                outOfStockProducts: 1,
            },
        });

        const service = new SellerDashboardService(
            ownership as never,
            orderClient as never,
            productClient as never,
        );
        const result = await service.getOverview('owner-1');

        expect(orderClient.getSnapshot).toHaveBeenCalledWith(
            'shop-1',
            expect.objectContaining({ key: '30d' }),
        );
        expect(productClient.getSnapshot).toHaveBeenCalledWith(
            'shop-1',
            'owner-1',
        );
        expect(result.kpis).toMatchObject({
            grossRevenue: 1200000,
            orderCount: 3,
            pendingConfirmation: 1,
            pendingReturns: 2,
            catalogProducts: 6,
            activeProducts: 4,
            inStockProducts: 3,
            stockUnits: 25,
            outOfStockProducts: 1,
        });
        expect(result.kpis.grossRevenueChangePercent).toBe(20);
        expect(result.revenueTrend).toHaveLength(30);
    });

    // Ranking doanh số phải đến từ Order Service; catalog service chỉ cấp số liệu tồn, không lifetime total_sold.
    it('keeps period sales from order data and never merges catalog ranking', async () => {
        // Arrange
        ownership.findOwnedShop.mockResolvedValue({
            id: 'shop-1',
            name: 'Shop Một',
            status: ShopStatus.ACTIVE,
            logoUrl: '',
        });
        orderClient.getSnapshot.mockResolvedValue({
            current: { grossRevenue: 0, orderCount: 0 },
            previous: { grossRevenue: 0, orderCount: 0 },
            revenueTrend: [],
            orderStatusCounts: {
                all: 0,
                pendingConfirmation: 0,
                pendingShipment: 0,
                shipping: 0,
                delivered: 0,
                completed: 0,
                cancelled: 0,
                returnRefund: 0,
            },
            pendingReturns: 0,
            latestOrders: [],
            recentReturnOrders: [],
            topProducts: Array.from({ length: 2 }, (_, index) => ({
                productId: `order-product-${index}`,
                name: `Order Product ${index}`,
                thumbnailUrl: null,
                quantitySold: 6 - index,
                revenue: 1000,
            })),
            topProductsTotalCount: 2,
            topProductsHasMore: false,
        });
        productClient.getSnapshot.mockResolvedValue({
            summary: {
                catalogProducts: 6,
                activeProducts: 6,
                inStockProducts: 6,
                stockUnits: 60,
                outOfStockProducts: 0,
            },
        });
        const target = new SellerDashboardService(
            ownership as never,
            orderClient as never,
            productClient as never,
        );

        // Act
        const result = await target.getOverview('owner-1');

        // Assert
        expect(result.topProducts).toHaveLength(2);
        expect(result.topProducts.map((product) => product.productId)).toEqual([
            'order-product-0',
            'order-product-1',
        ]);
        expect(result.topProductsTotalCount).toBe(2);
    });
});
