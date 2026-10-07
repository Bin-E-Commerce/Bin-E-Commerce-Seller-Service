// Contract public của Seller Dashboard; Seller Service ghép dữ liệu từ các service sở hữu domain.

// Range giữ preset cũ và thêm tháng lịch có định dạng kiểm soát để dashboard truy vấn đúng kỳ tuyệt đối.
export type SellerDashboardRange =
    | '7d'
    | '30d'
    | '90d'
    | 'current-month'
    | `calendar-month:${number}-${number}`;

export interface SellerDashboardDateRange {
    key: SellerDashboardRange;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
}

export interface SellerDashboardSnapshot {
    generatedAt: string;
    timezone: 'Asia/Ho_Chi_Minh';
    shop: {
        id: string;
        name: string;
        status: string;
        logoUrl: string | null;
    };
    range: SellerDashboardDateRange;
    kpis: {
        grossRevenue: number;
        grossRevenuePreviousPeriod: number;
        grossRevenueChangePercent: number | null;
        orderCount: number;
        orderCountPreviousPeriod: number;
        orderChangePercent: number | null;
        pendingConfirmation: number;
        pendingShipment: number;
        shipping: number;
        pendingReturns: number;
        catalogProducts: number;
        activeProducts: number;
        inStockProducts: number;
        stockUnits: number;
        outOfStockProducts: number;
    };
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
    latestOrders: Array<{
        id: string;
        orderNumber: string;
        status: string;
        fulfillmentStatus: string;
        grossAmount: number;
        itemCount: number;
        itemLineCount: number;
        returnReason?: string | null;
        returnDescription?: string | null;
        cancelReason?: string | null;
        items: Array<{
            productId: string;
            name: string;
            thumbnailUrl: string | null;
            quantity: number;
            lineTotal: number;
        }>;
        createdAt: string;
    }>;
    recentReturnOrders: SellerDashboardSnapshot['latestOrders'];
    recentReturnOrdersHasMore: boolean;
    actionableOrders: SellerDashboardSnapshot['latestOrders'];
    actionableOrdersHasMore: boolean;
    cancelledOrders: SellerDashboardSnapshot['latestOrders'];
    cancelledOrdersHasMore: boolean;
    deliveredOrders: SellerDashboardSnapshot['latestOrders'];
    deliveredOrdersHasMore: boolean;
    completedOrders: SellerDashboardSnapshot['latestOrders'];
    completedOrdersHasMore: boolean;
    topProductsTotalCount: number;
    topProductsHasMore: boolean;
    topProducts: Array<{
        productId: string;
        name: string;
        thumbnailUrl: string | null;
        quantitySold: number;
        revenue: number | null;
        stock: number | null;
    }>;
}
