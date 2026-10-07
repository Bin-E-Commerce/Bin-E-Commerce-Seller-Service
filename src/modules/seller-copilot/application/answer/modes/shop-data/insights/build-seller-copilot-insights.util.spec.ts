// Kiểm thử insight chỉ được tạo từ loại visual được yêu cầu và dữ liệu dashboard/profile đã xác thực.
import type { SellerDashboardSnapshot } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';
import { buildSellerCopilotInsights } from '@/modules/seller-copilot/application/answer/modes/shop-data/insights/build-seller-copilot-insights.util';

// Dựng snapshot dashboard đầy đủ theo contract để các ca kiểm thử không ép kiểu payload rút gọn thành production type.
function createDashboardSnapshot(
    revenueTrend: SellerDashboardSnapshot['revenueTrend'],
    topProducts: SellerDashboardSnapshot['topProducts'],
    from: string,
    to: string,
): SellerDashboardSnapshot {
    return {
        generatedAt: '2026-10-02T00:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        shop: {
            id: 'shop-1',
            name: 'Shop thử nghiệm',
            status: 'ACTIVE',
            logoUrl: null,
        },
        range: {
            key: 'current-month',
            from,
            to,
            previousFrom: '2026-09-01',
            previousTo: '2026-09-30',
        },
        kpis: {
            grossRevenue: 300000,
            grossRevenuePreviousPeriod: 200000,
            grossRevenueChangePercent: 50,
            orderCount: 3,
            orderCountPreviousPeriod: 2,
            orderChangePercent: 50,
            pendingConfirmation: 0,
            pendingShipment: 0,
            shipping: 0,
            pendingReturns: 0,
            catalogProducts: 1,
            activeProducts: 1,
            inStockProducts: 1,
            stockUnits: 4,
            outOfStockProducts: 0,
        },
        revenueTrend,
        orderStatusCounts: {
            all: 3,
            pendingConfirmation: 0,
            pendingShipment: 0,
            shipping: 0,
            delivered: 0,
            completed: 3,
            cancelled: 0,
            returnRefund: 0,
        },
        latestOrders: [],
        recentReturnOrders: [],
        recentReturnOrdersHasMore: false,
        actionableOrders: [],
        actionableOrdersHasMore: false,
        cancelledOrders: [],
        cancelledOrdersHasMore: false,
        deliveredOrders: [],
        deliveredOrdersHasMore: false,
        completedOrders: [],
        completedOrdersHasMore: false,
        topProductsTotalCount: topProducts.length,
        topProductsHasMore: false,
        topProducts,
    };
}

// Chỉ phát biểu đồ, sản phẩm và hồ sơ khi model chọn đúng ngữ cảnh; nội dung hiển thị vẫn lấy nguyên từ dữ liệu nguồn.
it('builds only the selected visuals from the available seller data', () => {
    const dashboard = createDashboardSnapshot(
        [
            { date: '2026-10-01', grossRevenue: 100000, orderCount: 1 },
            { date: '2026-10-02', grossRevenue: 200000, orderCount: 2 },
        ],
        [
            {
                productId: 'product-1',
                name: 'Áo thể thao',
                thumbnailUrl: 'https://cdn.example.test/product.jpg',
                quantitySold: 3,
                revenue: 300000,
                stock: 4,
            },
        ],
        '2026-09-30T17:00:00.000Z',
        '2026-10-02T16:59:59.999Z',
    );

    const insights = buildSellerCopilotInsights({
        visualizationTypes: ['revenue_trend', 'top_products', 'seller_profile'],
        dashboard,
        account: {
            name: 'Người bán thử nghiệm',
            avatarUrl: 'https://cdn.example.test/avatar.jpg',
            email: 'seller@example.test',
            phone: null,
            role: 'SELLER',
            status: 'ACTIVE',
        },
        shop: {
            name: 'Shop thử nghiệm',
            logoUrl: 'https://cdn.example.test/shop.jpg',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });

    expect(insights).toEqual([
        {
            type: 'REVENUE_TREND',
            range: { from: '2026-10-01', to: '2026-10-02' },
            points: [
                { date: '2026-10-01', grossRevenue: 100000 },
                { date: '2026-10-02', grossRevenue: 200000 },
            ],
        },
        {
            type: 'PRODUCT_PERFORMANCE',
            productId: 'product-1',
            name: 'Áo thể thao',
            thumbnailUrl: 'https://cdn.example.test/product.jpg',
            quantitySold: 3,
            revenue: 300000,
        },
        {
            type: 'SELLER_PROFILE',
            account: {
                name: 'Người bán thử nghiệm',
                avatarUrl: 'https://cdn.example.test/avatar.jpg',
                email: 'seller@example.test',
                phone: null,
                role: 'SELLER',
                status: 'ACTIVE',
            },
            shop: {
                name: 'Shop thử nghiệm',
                logoUrl: 'https://cdn.example.test/shop.jpg',
                description: null,
                businessModel: 'RETAIL',
                status: 'ACTIVE',
            },
        },
    ]);
});

// Câu hỏi về sản phẩm bán chạy nhất chỉ tạo một thẻ cho mặt hàng có số lượng bán cao nhất.
// Các sản phẩm chưa bán không phải ứng viên; nếu đồng hạng, doanh thu cao hơn được ưu tiên.
it('returns only the best-selling product and excludes unsold catalog items', () => {
    // Arrange
    const dashboard = createDashboardSnapshot(
        [],
        [
            {
                productId: 'product-lower-sales',
                name: 'Áo nam form rộng',
                thumbnailUrl: 'https://cdn.example.test/lower-sales.jpg',
                quantitySold: 1,
                revenue: 450000,
                stock: 8,
            },
            {
                productId: 'product-best-seller',
                name: 'Áo thể thao',
                thumbnailUrl: 'https://cdn.example.test/best-seller.jpg',
                quantitySold: 3,
                revenue: 555000,
                stock: 4,
            },
            {
                productId: 'product-unsold',
                name: 'Giày chưa bán',
                thumbnailUrl: null,
                quantitySold: 0,
                revenue: null,
                stock: 20,
            },
        ],
        '2026-10-01',
        '2026-10-30',
    );

    // Act
    const insights = buildSellerCopilotInsights({
        visualizationTypes: ['top_products'],
        dashboard,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });

    // Assert
    expect(insights).toEqual([
        {
            type: 'PRODUCT_PERFORMANCE',
            productId: 'product-best-seller',
            name: 'Áo thể thao',
            thumbnailUrl: 'https://cdn.example.test/best-seller.jpg',
            quantitySold: 3,
            revenue: 555000,
        },
    ]);
});

// Danh sách đã bán lọc sản phẩm 0 lượt và xếp số lượng giảm dần thay vì lặp catalog chưa bán.
it('builds only products with actual sales for sold-products requests', () => {
    const dashboard = createDashboardSnapshot(
        [],
        [
            {
                productId: 'unsold',
                name: 'Chưa bán',
                thumbnailUrl: null,
                quantitySold: 0,
                revenue: 0,
                stock: 12,
            },
            {
                productId: 'sold-second',
                name: 'Đã bán hai',
                thumbnailUrl: null,
                quantitySold: 2,
                revenue: 200000,
                stock: 12,
            },
            {
                productId: 'sold-first',
                name: 'Đã bán ba',
                thumbnailUrl: null,
                quantitySold: 3,
                revenue: 300000,
                stock: 8,
            },
        ],
        '2026-10-01',
        '2026-10-30',
    );

    expect(
        buildSellerCopilotInsights({
            visualizationTypes: ['sold_products'],
            dashboard,
            shop: {
                name: 'Shop thử nghiệm',
                description: null,
                businessModel: 'RETAIL',
                status: 'ACTIVE',
            },
        }),
    ).toEqual([
        expect.objectContaining({
            type: 'PRODUCT_PERFORMANCE',
            productId: 'sold-first',
            quantitySold: 3,
        }),
        expect.objectContaining({
            type: 'PRODUCT_PERFORMANCE',
            productId: 'sold-second',
            quantitySold: 2,
        }),
    ]);
});

// Product catalog giữ mọi sản phẩm/ảnh/option từ snapshot; LOW_STOCK lấy riêng các biến thể dưới ngưỡng.
it('builds the full catalog and chooses the lowest available variant for low-stock questions', () => {
    // Arrange
    const dashboard = createDashboardSnapshot(
        [],
        [
            {
                productId: 'best-seller',
                name: 'Áo bán chạy',
                thumbnailUrl: 'https://cdn.example.test/top.jpg',
                quantitySold: 30,
                revenue: 1000000,
                stock: 40,
            },
        ],
        '2026-10-01',
        '2026-10-30',
    );
    const productCatalog = {
        totalCount: 2,
        hasMore: false,
        items: [
            {
                productId: 'low-stock-product',
                name: 'Quần dài nam',
                description: 'Quần ống suông.',
                thumbnailUrl: 'https://cdn.example.test/trousers.jpg',
                status: 'ACTIVE',
                totalSold: 1,
                availableTotal: 22,
                variantCount: 2,
                hasMoreVariants: false,
                variants: [
                    {
                        variantId: 'variant-low',
                        name: 'Đen / M',
                        sku: 'SKU-LOW',
                        sellerSku: 'SHOP-LOW',
                        options: [
                            { name: 'Màu sắc', value: 'Đen' },
                            { name: 'Size', value: 'M' },
                        ],
                        price: 320000,
                        originalPrice: null,
                        available: 2,
                        reserved: 1,
                        quantitySold: 1,
                        lowStockThreshold: 5,
                        thumbnailUrl: 'https://cdn.example.test/trousers.jpg',
                    },
                    {
                        variantId: 'variant-normal',
                        name: 'Đen / L',
                        sku: 'SKU-NORMAL',
                        sellerSku: null,
                        options: [],
                        price: 320000,
                        originalPrice: null,
                        available: 20,
                        reserved: 0,
                        quantitySold: 0,
                        lowStockThreshold: 5,
                        thumbnailUrl: 'https://cdn.example.test/trousers.jpg',
                    },
                ],
            },
            {
                productId: 'second-product',
                name: 'Giày sục',
                description: null,
                thumbnailUrl: 'https://cdn.example.test/shoes.jpg',
                status: 'ACTIVE',
                totalSold: 0,
                availableTotal: 0,
                variantCount: 1,
                hasMoreVariants: false,
                variants: [
                    {
                        variantId: 'variant-out-of-stock',
                        name: 'Nâu / 39',
                        sku: 'SKU-EMPTY',
                        sellerSku: null,
                        options: [],
                        price: 190000,
                        originalPrice: null,
                        available: 0,
                        reserved: 0,
                        quantitySold: 0,
                        lowStockThreshold: 5,
                        thumbnailUrl: 'https://cdn.example.test/shoes.jpg',
                    },
                ],
            },
        ],
    };

    // Act
    const catalogInsights = buildSellerCopilotInsights({
        visualizationTypes: ['product_catalog'],
        dashboard,
        productCatalog,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });
    const lowStockInsights = buildSellerCopilotInsights({
        visualizationTypes: ['low_stock'],
        dashboard,
        productCatalog,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });
    const outOfStockInsights = buildSellerCopilotInsights({
        visualizationTypes: ['out_of_stock'],
        dashboard,
        productCatalog,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });
    const noRevenueInsights = buildSellerCopilotInsights({
        visualizationTypes: ['products_without_revenue'],
        dashboard,
        productCatalog,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });

    // Assert
    expect(catalogInsights).toEqual([
        {
            type: 'PRODUCT_CATALOG',
            items: productCatalog.items,
            totalCount: 2,
            hasMore: false,
        },
    ]);
    expect(lowStockInsights).toEqual([
        {
            type: 'LOW_STOCK',
            productId: 'low-stock-product',
            name: 'Quần dài nam',
            thumbnailUrl: 'https://cdn.example.test/trousers.jpg',
            stock: 2,
            variantName: 'Đen / M',
        },
    ]);
    expect(outOfStockInsights).toEqual([
        {
            type: 'LOW_STOCK',
            productId: 'second-product',
            name: 'Giày sục',
            thumbnailUrl: 'https://cdn.example.test/shoes.jpg',
            stock: 0,
            variantName: 'Nâu / 39',
        },
    ]);
    expect(noRevenueInsights).toEqual([
        {
            type: 'PRODUCTS_WITHOUT_REVENUE',
            range: dashboard.range,
            hasMore: false,
            items: [
                {
                    productId: 'low-stock-product',
                    name: 'Quần dài nam',
                    thumbnailUrl: 'https://cdn.example.test/trousers.jpg',
                },
                {
                    productId: 'second-product',
                    name: 'Giày sục',
                    thumbnailUrl: 'https://cdn.example.test/shoes.jpg',
                },
            ],
        },
    ]);
});

// Khi thiếu chuỗi xu hướng đủ dài, không dựng chart từ một điểm đơn lẻ hoặc dữ liệu lỗi.
it('omits the revenue visual when the source has fewer than two valid points', () => {
    const dashboard = createDashboardSnapshot(
        [
            { date: '2026-10-01', grossRevenue: 100000, orderCount: 1 },
            { date: 'invalid-date', grossRevenue: 200000, orderCount: 2 },
        ],
        [],
        '2026-10-01',
        '2026-10-01',
    );

    expect(
        buildSellerCopilotInsights({
            visualizationTypes: ['revenue_trend'],
            dashboard,
            shop: {
                name: 'Shop thử nghiệm',
                description: null,
                businessModel: 'RETAIL',
                status: 'ACTIVE',
            },
        }),
    ).toEqual([]);
});

// Visual đơn hàng phải lọc đúng trạng thái theo loại câu hỏi, không để đơn hoàn trả lẫn vào danh sách hoàn thành.
it('builds order details, completed orders, and return orders from their scoped dashboard lists', () => {
    // Arrange
    const order = {
        id: 'order-1',
        orderNumber: 'BIN-ORDER-001',
        status: 'CONFIRMED',
        fulfillmentStatus: 'RETURN_REFUND',
        grossAmount: 450000,
        itemCount: 2,
        itemLineCount: 1,
        returnReason: 'DAMAGED',
        returnDescription: 'Sản phẩm bị rách.',
        items: [
            {
                productId: 'product-1',
                name: 'Áo thể thao',
                thumbnailUrl: 'https://cdn.example.test/shirt.jpg',
                quantity: 2,
                lineTotal: 450000,
            },
        ],
        createdAt: '2026-09-19T03:00:00.000Z',
    };
    const baseDashboard = createDashboardSnapshot(
        [],
        [],
        '2026-10-01',
        '2026-10-02',
    );
    const dashboard = {
        ...baseDashboard,
        orderStatusCounts: {
            ...baseDashboard.orderStatusCounts,
            completed: 4,
        },
        latestOrders: [
            order,
            { ...order, id: 'order-2', fulfillmentStatus: 'COMPLETED' },
        ],
        recentReturnOrders: [order],
        recentReturnOrdersHasMore: true,
    };

    // Act
    const insights = buildSellerCopilotInsights({
        visualizationTypes: [
            'order_details',
            'completed_orders',
            'return_orders',
        ],
        dashboard,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });

    // Assert
    expect(insights).toEqual([
        {
            type: 'ORDER_DETAILS',
            orders: dashboard.latestOrders.map((currentOrder) => ({
                ...currentOrder,
                cancelReason: null,
                returnReason: 'DAMAGED',
                returnDescription: 'Sản phẩm bị rách.',
            })),
        },
        {
            type: 'ORDER_STATUS_COUNT',
            fulfillmentStatus: 'COMPLETED',
            count: 4,
        },
        {
            type: 'RETURN_ORDERS',
            orders: [
                {
                    ...order,
                    cancelReason: null,
                    items: order.items.map((item) => ({
                        ...item,
                        thumbnailUrl: item.thumbnailUrl,
                    })),
                },
            ],
            hasMore: true,
        },
    ]);
});

// Card theo trạng thái phải dùng tập riêng; completed không nhận đơn hoàn trả hay đơn nằm ngoài trang giới hạn.
it('builds actionable and cancelled order cards only from their validated queues', () => {
    // Arrange
    const order = {
        id: 'order-cancelled',
        orderNumber: 'BIN-CANCELLED-001',
        status: 'CANCELLED',
        fulfillmentStatus: 'CANCELLED',
        grossAmount: 120000,
        itemCount: 1,
        itemLineCount: 1,
        returnReason: null,
        returnDescription: null,
        cancelReason: 'Khách đổi ý',
        items: [
            {
                productId: 'product-1',
                name: 'Áo thể thao',
                thumbnailUrl: null,
                quantity: 1,
                lineTotal: 120000,
            },
        ],
        createdAt: '2026-09-19T03:00:00.000Z',
    };
    const dashboard = {
        ...createDashboardSnapshot([], [], '2026-10-01', '2026-10-02'),
        actionableOrders: [
            {
                ...order,
                id: 'order-actionable',
                status: 'CONFIRMED',
                fulfillmentStatus: 'DELIVERY_FAILED',
            },
        ],
        actionableOrdersHasMore: true,
        cancelledOrders: [order],
        cancelledOrdersHasMore: false,
        latestOrders: [],
    };

    // Act
    const insights = buildSellerCopilotInsights({
        visualizationTypes: ['actionable_orders', 'cancelled_orders'],
        dashboard,
        shop: {
            name: 'Shop thử nghiệm',
            description: null,
            businessModel: 'RETAIL',
            status: 'ACTIVE',
        },
    });

    // Assert
    expect(insights).toEqual([
        {
            type: 'ACTIONABLE_ORDERS',
            orders: [
                expect.objectContaining({
                    id: 'order-actionable',
                    fulfillmentStatus: 'DELIVERY_FAILED',
                }),
            ],
            hasMore: true,
        },
        {
            type: 'CANCELLED_ORDERS',
            orders: [expect.objectContaining({ cancelReason: 'Khách đổi ý' })],
            hasMore: false,
        },
    ]);
});
