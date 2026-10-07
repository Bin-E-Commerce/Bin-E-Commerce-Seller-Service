// Khai báo các presentation của dữ liệu shop để resolver và context builder dùng chung hợp đồng nội bộ.
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import type { SellerCopilotVisualizationType } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Loại presentation đơn hàng quyết định tập dữ liệu đã được lọc ở dashboard service.
export type SellerCopilotOrderPresentation =
    | 'count'
    | 'completed-list'
    | 'returns'
    | 'actionable'
    | 'cancelled'
    | 'delivered-list'
    | 'details'
    | 'overview';

// Loại presentation sản phẩm quyết định aggregate/catalog nào cần được tải.
export type SellerCopilotProductPresentation =
    | 'count'
    | 'stock-summary'
    | 'catalog'
    | 'low-stock'
    | 'sold-list'
    | 'no-revenue-list'
    | 'top'
    | 'detail'
    | 'overview';

// Hợp đồng đã chuẩn hóa để data loader, answer context và card builder cùng chọn một nguồn.
export interface SellerCopilotShopDataPresentation {
    tasks: SellerQuestionTask[];
    visualizationTypes: SellerCopilotVisualizationType[];
    orderPresentations: SellerCopilotOrderPresentation[];
    productPresentations: SellerCopilotProductPresentation[];
    revenueIntents: Array<
        'revenue_total' | 'revenue_comparison' | 'revenue_trend'
    >;
    includeRevenueTrend: boolean;
}
