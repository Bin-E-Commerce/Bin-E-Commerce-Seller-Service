// Kiểm tra mapping từ intent có cấu trúc sang nguồn/card; không phụ thuộc từ khóa trong câu diễn giải.
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { resolveShopDataPresentation } from '@/modules/seller-copilot/application/answer/modes/shop-data/presentation/resolve-shop-data-presentation.util';

describe('resolveShopDataPresentation', () => {
    // Intent đã validate là đầu vào duy nhất để chọn dashboard query và visualization.
    it('maps explicit shop-data intents to their data presentations and visuals', () => {
        // Arrange
        const tasks: SellerQuestionTask[] = [
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Cho thông tin chi tiết của các mặt hàng',
                shopDataIntent: 'product_catalog',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Các mặt hàng có tồn kho thấp',
                shopDataIntent: 'low_stock_products',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Sản phẩm đã bán trong kỳ',
                shopDataIntent: 'sold_products',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-orders',
                resolvedQuestion: 'Các đơn cần xử lý',
                shopDataIntent: 'actionable_orders',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-revenue',
                resolvedQuestion: 'Doanh thu theo ngày',
                shopDataIntent: 'revenue_trend',
            },
        ];

        // Act
        const result = resolveShopDataPresentation({ tasks });

        // Assert: câu chữ không được dùng để đổi intent hoặc chọn visualization.
        expect(result.tasks).toEqual(tasks);
        expect(result.productPresentations).toEqual([
            'catalog',
            'low-stock',
            'sold-list',
        ]);
        expect(result.orderPresentations).toEqual(['actionable']);
        expect(result.revenueIntents).toEqual(['revenue_trend']);
        expect(result.includeRevenueTrend).toBe(true);
        expect(result.visualizationTypes).toEqual([
            'product_catalog',
            'low_stock',
            'sold_products',
            'actionable_orders',
            'revenue_trend',
        ]);
    });

    // Count, stock summary và detail giữ ba cách lấy context khác nhau dù cùng thuộc seller-products-inventory.
    it('keeps catalog count, stock metrics, and product details as separate presentations', () => {
        // Arrange
        const tasks: SellerQuestionTask[] = [
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Shop có bao nhiêu sản phẩm?',
                shopDataIntent: 'product_count',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Tồn kho còn bao nhiêu?',
                shopDataIntent: 'stock_unit_count',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Chi tiết mặt hàng đã nhắc tới',
                shopDataIntent: 'product_detail',
            },
        ];

        // Act
        const result = resolveShopDataPresentation({ tasks });

        // Assert
        expect(result.productPresentations).toEqual([
            'count',
            'stock-summary',
            'detail',
        ]);
        expect(result.visualizationTypes).toEqual([
            'stock_summary',
            'product_catalog',
        ]);
    });

    // Intent overview phải thật sự nạp catalog/card; nếu chỉ có nhãn intent, model không thể trình bày đầy đủ snapshot.
    it('loads product and order snapshots for overview intents', () => {
        // Arrange
        const tasks: SellerQuestionTask[] = [
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Cho tôi xem các sản phẩm hiện có trong shop',
                shopDataIntent: 'product_overview',
            },
            {
                requestType: 'READ_QUERY',
                domain: 'seller-orders',
                resolvedQuestion: 'Tổng quan các đơn hàng gần đây',
                shopDataIntent: 'order_overview',
            },
        ];

        // Act
        const result = resolveShopDataPresentation({ tasks });

        // Assert: mỗi intent được nối tới nguồn và card tương ứng, không để answer model tự dựng danh sách.
        expect(result.productPresentations).toEqual(['catalog']);
        expect(result.orderPresentations).toEqual(['overview']);
        expect(result.visualizationTypes).toEqual([
            'product_catalog',
            'order_details',
        ]);
    });

    // Profile thuộc domain đã được registry xác nhận nên tự bật card, còn mọi metric vẫn phải có intent tương ứng.
    it('adds the seller profile visual without inferring a shop-data intent', () => {
        // Arrange
        const task: SellerQuestionTask = {
            requestType: 'READ_QUERY',
            domain: 'seller-profile',
            resolvedQuestion: 'Thông tin tài khoản và cửa hàng',
        };

        // Act
        const result = resolveShopDataPresentation({ tasks: [task] });

        // Assert
        expect(result.visualizationTypes).toEqual(['seller_profile']);
        expect(result.productPresentations).toEqual([]);
        expect(result.orderPresentations).toEqual([]);
        expect(result.includeRevenueTrend).toBe(false);
    });
});
