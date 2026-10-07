// Chuyển intent đã được planner trả về và backend validate thành dữ liệu/card cần nạp cho câu trả lời.
import type {
    SellerQuestionShopDataIntent,
    SellerQuestionTask,
} from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import type { SellerCopilotVisualizationType } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import type {
    SellerCopilotOrderPresentation,
    SellerCopilotProductPresentation,
    SellerCopilotShopDataPresentation,
} from '@/modules/seller-copilot/application/answer/modes/shop-data/types/seller-copilot-shop-data-presentation.types';

// Mỗi enum intent phải có quyết định rõ: visual tương ứng hoặc null nếu chỉ cần câu trả lời số liệu.
// Record đầy đủ làm TypeScript báo lỗi khi thêm intent mới mà quên nối nó tới card hoặc quyết định chủ động không dùng card.
const VISUALIZATION_BY_INTENT: Record<
    SellerQuestionShopDataIntent,
    SellerCopilotVisualizationType | null
> = {
    revenue_total: 'revenue_trend',
    revenue_comparison: 'revenue_trend',
    revenue_trend: 'revenue_trend',
    product_count: null,
    in_stock_product_count: 'stock_summary',
    stock_unit_count: 'stock_summary',
    sold_products: 'sold_products',
    products_without_revenue: 'products_without_revenue',
    top_product: 'top_products',
    product_catalog: 'product_catalog',
    product_detail: 'product_catalog',
    // Overview phải lấy catalog và dựng card; nếu chỉ trả metric aggregate, câu trả lời không thể nêu đủ tên sản phẩm.
    product_overview: 'product_catalog',
    low_stock_products: 'low_stock',
    out_of_stock_products: 'out_of_stock',
    actionable_orders: 'actionable_orders',
    order_status_count: null,
    completed_orders: 'completed_orders',
    completed_order_list: 'completed_order_list',
    delivered_orders: 'delivered_orders',
    cancelled_orders: 'cancelled_orders',
    return_orders: 'return_orders',
    order_detail: 'order_details',
    // Overview dùng latestOrders đã giới hạn gần đây; visual phải hiển thị cùng mẫu thay vì chỉ để model đọc nó.
    order_overview: 'order_details',
};

// Các intent ngoài seller-orders chủ động map null để không tải danh sách đơn nhầm nguồn.
const ORDER_PRESENTATION_BY_INTENT: Record<
    SellerQuestionShopDataIntent,
    SellerCopilotOrderPresentation | null
> = {
    revenue_total: null,
    revenue_comparison: null,
    revenue_trend: null,
    product_count: null,
    in_stock_product_count: null,
    stock_unit_count: null,
    sold_products: null,
    products_without_revenue: null,
    top_product: null,
    product_catalog: null,
    product_detail: null,
    low_stock_products: null,
    out_of_stock_products: null,
    product_overview: null,
    actionable_orders: 'actionable',
    order_status_count: 'count',
    completed_orders: 'count',
    completed_order_list: 'completed-list',
    delivered_orders: 'delivered-list',
    cancelled_orders: 'cancelled',
    return_orders: 'returns',
    order_detail: 'details',
    order_overview: 'overview',
};

// Các intent ngoài seller-products-inventory chủ động map null; detail và overview cùng dùng card catalog nhưng nguồn/query vẫn khác nhau.
const PRODUCT_PRESENTATION_BY_INTENT: Record<
    SellerQuestionShopDataIntent,
    SellerCopilotProductPresentation | null
> = {
    revenue_total: null,
    revenue_comparison: null,
    revenue_trend: null,
    product_count: 'count',
    in_stock_product_count: 'stock-summary',
    stock_unit_count: 'stock-summary',
    sold_products: 'sold-list',
    products_without_revenue: 'no-revenue-list',
    top_product: 'top',
    product_catalog: 'catalog',
    product_detail: 'detail',
    low_stock_products: 'low-stock',
    out_of_stock_products: 'low-stock',
    // Câu hỏi tổng quan cần catalog thật để answer và card cùng nhìn thấy toàn bộ sản phẩm có trong snapshot.
    product_overview: 'catalog',
    actionable_orders: null,
    order_status_count: null,
    completed_orders: null,
    completed_order_list: null,
    delivered_orders: null,
    cancelled_orders: null,
    return_orders: null,
    order_detail: null,
    order_overview: null,
};

// Chuẩn hóa các task đã qua registry và intent validation thành nguồn/card duy nhất cho lượt trả lời.
export function resolveShopDataPresentation(input: {
    tasks: SellerQuestionTask[];
}): SellerCopilotShopDataPresentation {
    const tasks = input.tasks;
    const visualizationTypes = tasks
        .map((task) =>
            task.shopDataIntent
                ? VISUALIZATION_BY_INTENT[task.shopDataIntent]
                : null,
        )
        .filter(
            (type, index, all): type is SellerCopilotVisualizationType =>
                type !== null && all.indexOf(type) === index,
        );

    // Hồ sơ không có shop-data metric; domain profile đã qua registry nên backend tự cấp đúng card hồ sơ.
    if (
        tasks.some((task) => task.domain === 'seller-profile') &&
        !visualizationTypes.includes('seller_profile')
    ) {
        visualizationTypes.push('seller_profile');
    }

    const orderPresentations = tasks
        .map((task) =>
            task.shopDataIntent
                ? ORDER_PRESENTATION_BY_INTENT[task.shopDataIntent]
                : null,
        )
        .filter(
            (presentation): presentation is SellerCopilotOrderPresentation =>
                presentation !== null,
        );
    const productPresentations = tasks
        .map((task) =>
            task.shopDataIntent
                ? PRODUCT_PRESENTATION_BY_INTENT[task.shopDataIntent]
                : null,
        )
        .filter(
            (presentation): presentation is SellerCopilotProductPresentation =>
                presentation !== null,
        );
    const revenueIntents = tasks.flatMap((task) => {
        switch (task.shopDataIntent) {
            case 'revenue_total':
            case 'revenue_comparison':
            case 'revenue_trend':
                return [task.shopDataIntent];
            default:
                return [];
        }
    });

    return {
        tasks,
        visualizationTypes,
        orderPresentations: [...new Set(orderPresentations)],
        productPresentations: [...new Set(productPresentations)],
        revenueIntents: [...new Set(revenueIntents)],
        includeRevenueTrend: revenueIntents.length > 0,
    };
}
