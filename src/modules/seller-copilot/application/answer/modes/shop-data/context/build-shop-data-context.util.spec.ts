// Kiểm tra context model nhận đúng aggregate/danh sách theo intent và không trộn các nguồn nghiệp vụ.
import { buildShopDataAnswerContext } from '@/modules/seller-copilot/application/answer/modes/shop-data/context/build-shop-data-context.util';

describe('buildShopDataAnswerContext', () => {
    const snapshot = {
        generatedAt: '2026-10-06T00:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        range: { key: '30d', from: '2026-09-07', to: '2026-10-07' },
        kpis: {
            grossRevenue: 1500000,
            grossRevenuePreviousPeriod: 1000000,
            grossRevenueChangePercent: 50,
            orderCount: 5,
            orderCountPreviousPeriod: 3,
            orderChangePercent: 66.7,
            pendingConfirmation: 1,
            pendingShipment: 2,
            pendingReturns: 1,
            catalogProducts: 4,
            activeProducts: 3,
            inStockProducts: 2,
            stockUnits: 37,
            outOfStockProducts: 1,
        },
        orderStatusCounts: { all: 5, completed: 4 },
        latestOrders: [
            { orderNumber: 'completed-1', fulfillmentStatus: 'COMPLETED' },
            { orderNumber: 'returned-1', fulfillmentStatus: 'RETURN_REFUND' },
        ],
        recentReturnOrders: [
            { orderNumber: 'returned-1', returnReason: 'DAMAGED' },
        ],
        actionableOrders: [
            { orderNumber: 'urgent-1', fulfillmentStatus: 'DELIVERY_FAILED' },
        ],
        actionableOrdersHasMore: true,
        cancelledOrders: [
            { orderNumber: 'cancelled-1', cancelReason: 'Khách đổi ý' },
        ],
        cancelledOrdersHasMore: false,
        deliveredOrders: [
            { orderNumber: 'delivered-1', fulfillmentStatus: 'DELIVERED' },
        ],
        deliveredOrdersHasMore: false,
        completedOrders: [
            { orderNumber: 'completed-1', fulfillmentStatus: 'COMPLETED' },
        ],
        completedOrdersHasMore: false,
        revenueTrend: [{ date: '2026-10-01', grossRevenue: 1500000 }],
        topProducts: [
            {
                productId: 'sold-1',
                name: 'Đã bán trong kỳ',
                quantitySold: 2,
                revenue: 120000,
            },
        ],
        topProductsTotalCount: 1,
        topProductsHasMore: false,
    } as never;

    // Đếm đơn hoàn thành chỉ đưa aggregate vào prompt, tránh để model tự đếm mẫu đơn hữu hạn.
    it('should keep aggregate-only context for an order count', () => {
        // Arrange / Act
        const context = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: true, products: false },
            { orders: ['count'], products: [] },
        );

        // Assert
        expect(context).toHaveProperty('orderStatusCounts');
        expect(context).not.toHaveProperty('latestOrders');
        expect(context).not.toHaveProperty('actionableOrders');
    });

    // Danh sách hoàn thành và hàng đợi thao tác phải lấy đúng read model riêng.
    it('should keep status-specific order lists separate', () => {
        // Arrange / Act
        const completedContext = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: true, products: false },
            { orders: ['completed-list'], products: [] },
        );
        const actionableContext = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: true, products: false },
            { orders: ['actionable'], products: [] },
        );

        // Assert
        expect(completedContext).toHaveProperty('completedOrders', [
            { orderNumber: 'completed-1', fulfillmentStatus: 'COMPLETED' },
        ]);
        expect(completedContext).not.toHaveProperty('latestOrders');
        expect(actionableContext).toHaveProperty('actionableOrders', [
            { orderNumber: 'urgent-1', fulfillmentStatus: 'DELIVERY_FAILED' },
        ]);
        expect(actionableContext).not.toHaveProperty('latestOrders');
    });

    // Câu hỏi bán hàng chỉ thấy aggregate Order Service theo kỳ, không được xem sản phẩm chưa bán từ catalog.
    it('should include only period sales for sold-product intents', () => {
        // Arrange / Act
        const context = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: false, products: true },
            { orders: [], products: ['sold-list'] },
        );

        // Assert
        expect(context).toHaveProperty('topProducts', [
            {
                productId: 'sold-1',
                name: 'Đã bán trong kỳ',
                quantitySold: 2,
                revenue: 120000,
            },
        ]);
        expect(context).toHaveProperty('topProductsTotalCount', 1);
        expect(context).toHaveProperty('productMetrics.inStockProducts', 2);
    });

    // Đếm catalog/tồn trả aggregate riêng; không đưa danh sách variant hữu hạn để model tự tính tổng.
    it('should provide labeled stock metrics without a product catalog list', () => {
        // Arrange / Act
        const context = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: false, products: true },
            { orders: [], products: ['stock-summary'] },
        );

        // Assert
        expect(context.productMetrics).toEqual({
            catalogProducts: 4,
            activeProducts: 3,
            inStockProducts: 2,
            stockUnits: 37,
            fullyOutOfStockProducts: 1,
        });
        expect(context).not.toHaveProperty('productCatalog');
    });

    // Hết hàng ở cấp biến thể phải dùng cùng danh sách đã lọc cho câu trả lời và card, không suy ra từ KPI sản phẩm.
    it('should provide the exact out-of-stock variants used by the card', () => {
        // Arrange
        const catalog = {
            totalCount: 1,
            hasMore: false,
            items: [
                {
                    productId: 'shirt-1',
                    name: 'Áo thể thao',
                    hasMoreVariants: false,
                    variants: [
                        {
                            variantId: 'shirt-size-s',
                            name: 'Size S',
                            available: 0,
                            lowStockThreshold: 5,
                        },
                        {
                            variantId: 'shirt-size-m',
                            name: 'Size M',
                            available: 4,
                            lowStockThreshold: 5,
                        },
                    ],
                },
            ],
        } as never;
        const presentation = {
            tasks: [
                {
                    requestType: 'READ_QUERY' as const,
                    domain: 'seller-products-inventory',
                    resolvedQuestion: 'Sản phẩm nào đã hết hàng?',
                    shopDataIntent: 'out_of_stock_products' as const,
                },
            ],
            orders: [],
            products: ['low-stock' as const],
        };

        // Act
        const context = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: false, products: true },
            presentation,
            catalog,
        );

        // Assert
        expect(context.stockAlerts).toEqual({
            kind: 'out_of_stock',
            variants: [
                {
                    productName: 'Áo thể thao',
                    variantName: 'Size S',
                    available: 0,
                },
            ],
            hasMore: false,
        });
        expect(context.productMetrics).not.toHaveProperty('outOfStockProducts');
    });

    // Anti-join phải so sánh catalog với aggregate hoàn tất cùng kỳ; khi aggregate bị cắt thì không gán nhãn sai.
    it('should derive products without revenue from the catalog and completed-sales aggregate', () => {
        const context = buildShopDataAnswerContext(
            snapshot,
            { revenue: false, orders: false, products: true },
            { orders: [], products: ['no-revenue-list'] },
            {
                totalCount: 3,
                hasMore: false,
                items: [
                    {
                        productId: 'sold-1',
                        name: 'Có doanh thu',
                        thumbnailUrl: null,
                    },
                    {
                        productId: 'unsold-1',
                        name: 'Chưa bán A',
                        thumbnailUrl: null,
                    },
                    {
                        productId: 'unsold-2',
                        name: 'Chưa bán B',
                        thumbnailUrl: null,
                    },
                ],
            } as never,
        );

        expect(context.productsWithoutRevenue).toEqual({
            range: { key: '30d', from: '2026-09-07', to: '2026-10-07' },
            totalCount: 2,
            hasMore: false,
            items: [
                {
                    productId: 'unsold-1',
                    name: 'Chưa bán A',
                    thumbnailUrl: null,
                },
                {
                    productId: 'unsold-2',
                    name: 'Chưa bán B',
                    thumbnailUrl: null,
                },
            ],
        });
    });

    // Không kết luận “chưa có doanh thu” khi truy vấn đơn hoàn tất đã chạm giới hạn nhóm sản phẩm.
    it('should withhold the no-revenue conclusion when sales aggregates are truncated', () => {
        const context = buildShopDataAnswerContext(
            Object.assign({}, snapshot, { topProductsHasMore: true }) as never,
            { revenue: false, orders: false, products: true },
            { orders: [], products: ['no-revenue-list'] },
            {
                totalCount: 1,
                hasMore: false,
                items: [
                    { productId: 'product-1', name: 'Áo', thumbnailUrl: null },
                ],
            } as never,
        );

        expect(context).not.toHaveProperty('productsWithoutRevenue');
        expect(context).toHaveProperty(
            'productsWithoutRevenueUnavailable',
            'sales_aggregate_limited',
        );
    });
});
