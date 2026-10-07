// Giới hạn payload dashboard gửi tới answer model theo đúng domain task; không tự lấy thêm KPI không được hỏi.
import type { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import type {
    SellerCopilotOrderPresentation,
    SellerCopilotProductPresentation,
} from '@/modules/seller-copilot/application/answer/modes/shop-data/types/seller-copilot-shop-data-presentation.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { resolveProductsWithoutRevenue } from '@/modules/seller-copilot/application/answer/modes/shop-data/products/resolve-products-without-revenue.util';
import { resolveProductStockAlerts } from '@/modules/seller-copilot/application/answer/modes/shop-data/products/resolve-product-stock-alerts.util';

type SellerDashboardSnapshot = Awaited<
    ReturnType<SellerDashboardService['getOverview']>
>;

// Chuyển snapshot đầy đủ thành context tối thiểu theo revenue/order/product đã được planner route.
export function buildShopDataAnswerContext(
    snapshot: SellerDashboardSnapshot,
    requestedDomains: {
        revenue: boolean;
        orders: boolean;
        products: boolean;
    },
    presentation?: {
        tasks?: SellerQuestionTask[];
        orders: SellerCopilotOrderPresentation[];
        products: SellerCopilotProductPresentation[];
    },
    productCatalog?: SellerCopilotProductCatalogSnapshot,
): Record<string, unknown> {
    const { revenue, orders, products } = requestedDomains;

    // KPI doanh thu chỉ được đưa vào prompt khi có task seller-revenue để tránh sản phẩm/đơn hàng kéo theo số liệu thừa.
    const kpis = {
        ...(revenue
            ? {
                  grossRevenue: snapshot.kpis.grossRevenue,
                  grossRevenuePreviousPeriod:
                      snapshot.kpis.grossRevenuePreviousPeriod,
                  grossRevenueChangePercent:
                      snapshot.kpis.grossRevenueChangePercent,
              }
            : {}),
        ...(orders
            ? {
                  orderCount: snapshot.kpis.orderCount,
                  orderCountPreviousPeriod:
                      snapshot.kpis.orderCountPreviousPeriod,
                  orderChangePercent: snapshot.kpis.orderChangePercent,
                  pendingConfirmation: snapshot.kpis.pendingConfirmation,
                  pendingShipment: snapshot.kpis.pendingShipment,
                  pendingReturns: snapshot.kpis.pendingReturns,
              }
            : {}),
    };

    // Intent theo trạng thái chỉ nhận snapshot đã lọc ở Order Service; latestOrders là mẫu gần đây có giới hạn, chỉ phục vụ overview/detail.
    // Vì vậy câu đếm chỉ nhận aggregate và danh sách hoàn/đã giao/đã hoàn thành không được suy ra bằng cách lọc mẫu latestOrders.
    const orderPresentations = presentation?.orders ?? [];
    const productPresentations = presentation?.products ?? [];
    const requestedOutOfStock =
        presentation?.tasks?.some(
            (task) => task.shopDataIntent === 'out_of_stock_products',
        ) ?? false;
    const requestedLowStock =
        presentation?.tasks?.some(
            (task) => task.shopDataIntent === 'low_stock_products',
        ) ?? false;
    const stockAlertKind = requestedOutOfStock
        ? 'out_of_stock'
        : requestedLowStock
          ? 'low_stock'
          : null;
    const stockAlertResult =
        stockAlertKind && productCatalog
            ? resolveProductStockAlerts(productCatalog, stockAlertKind)
            : undefined;
    const orderContext = orders
        ? orderPresentations.includes('count')
            ? { orderStatusCounts: snapshot.orderStatusCounts }
            : {
                  orderStatusCounts: snapshot.orderStatusCounts,
                  ...(orderPresentations.includes('returns')
                      ? {
                            recentReturnOrders: snapshot.recentReturnOrders,
                            recentReturnOrdersHasMore:
                                snapshot.recentReturnOrdersHasMore,
                        }
                      : {}),
                  ...(orderPresentations.includes('actionable')
                      ? {
                            actionableOrders: snapshot.actionableOrders,
                            actionableOrdersHasMore:
                                snapshot.actionableOrdersHasMore,
                        }
                      : {}),
                  ...(orderPresentations.includes('cancelled')
                      ? {
                            cancelledOrders: snapshot.cancelledOrders,
                            cancelledOrdersHasMore:
                                snapshot.cancelledOrdersHasMore,
                        }
                      : {}),
                  ...(orderPresentations.includes('delivered-list')
                      ? {
                            deliveredOrders: snapshot.deliveredOrders,
                            deliveredOrdersHasMore:
                                snapshot.deliveredOrdersHasMore,
                        }
                      : {}),
                  ...(orderPresentations.includes('completed-list')
                      ? {
                            completedOrders: snapshot.completedOrders,
                            completedOrdersHasMore:
                                snapshot.completedOrdersHasMore,
                        }
                      : {}),
                  ...(orderPresentations.includes('details') ||
                  orderPresentations.includes('overview')
                      ? { latestOrders: snapshot.latestOrders }
                      : {}),
              }
        : {};

    // Catalog/list/low-stock không cần top ranking; chỉ câu hỏi “đã bán/bán chạy” nhận danh sách sản phẩm theo doanh số.
    const includeTopProducts =
        products &&
        (productPresentations.includes('sold-list') ||
            productPresentations.includes('top') ||
            productPresentations.includes('no-revenue-list'));
    const noRevenueResult =
        productPresentations.includes('no-revenue-list') && productCatalog
            ? resolveProductsWithoutRevenue({
                  catalog: productCatalog,
                  completedSales: snapshot.topProducts,
                  salesHasMore: snapshot.topProductsHasMore,
              })
            : undefined;

    // Chỉ thêm context đã chọn; câu hỏi đơn hàng/doanh thu không bị nhiễu bởi số liệu sản phẩm ngoài phạm vi.
    return {
        generatedAt: snapshot.generatedAt,
        timezone: snapshot.timezone,
        range: snapshot.range,
        kpis,
        ...(orders ? orderContext : {}),
        ...(orders && !orderPresentations.includes('count')
            ? { pendingReturns: snapshot.kpis.pendingReturns }
            : {}),
        ...(revenue ? { revenueTrend: snapshot.revenueTrend } : {}),
        ...(products
            ? {
                  productMetrics: {
                      catalogProducts: snapshot.kpis.catalogProducts,
                      activeProducts: snapshot.kpis.activeProducts,
                      inStockProducts: snapshot.kpis.inStockProducts,
                      stockUnits: snapshot.kpis.stockUnits,
                      fullyOutOfStockProducts:
                          snapshot.kpis.outOfStockProducts,
                  },
              }
            : {}),
        ...(stockAlertResult && stockAlertKind
            ? {
                  stockAlerts: {
                      kind: stockAlertKind,
                      variants: stockAlertResult.items.map((item) => ({
                          productName: item.productName,
                          variantName: item.variantName,
                          available: item.stock,
                      })),
                      hasMore: stockAlertResult.hasMore,
                  },
              }
            : {}),
        ...(productPresentations.includes('count')
            ? { productCount: snapshot.kpis.catalogProducts }
            : {}),
        ...(includeTopProducts
            ? {
                  topProducts: snapshot.topProducts,
                  topProductsTotalCount: snapshot.topProductsTotalCount,
                  topProductsHasMore: snapshot.topProductsHasMore,
              }
            : {}),
        ...(noRevenueResult
            ? {
                  productsWithoutRevenue: {
                      range: snapshot.range,
                      totalCount: noRevenueResult.items.length,
                      hasMore: noRevenueResult.hasMore,
                      items: noRevenueResult.items,
                  },
              }
            : {}),
        ...(productPresentations.includes('no-revenue-list') &&
        productCatalog &&
        snapshot.topProductsHasMore
            ? { productsWithoutRevenueUnavailable: 'sales_aggregate_limited' }
            : {}),
    };
}
