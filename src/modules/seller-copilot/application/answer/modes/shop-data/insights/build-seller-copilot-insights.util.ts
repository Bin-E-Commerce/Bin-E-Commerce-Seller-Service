// Dựng insight giao diện từ allowlist loại visual và snapshot đã scope theo owner; không đọc nội dung answer để đoán dữ liệu.
import type {
    SellerCopilotInsight,
    SellerCopilotOrderInsight,
    SellerCopilotProductCatalogSnapshot,
    SellerCopilotVisualizationType,
} from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import type { SellerDashboardSnapshot } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';
import { resolveProductsWithoutRevenue } from '@/modules/seller-copilot/application/answer/modes/shop-data/products/resolve-products-without-revenue.util';
import { resolveProductStockAlerts } from '@/modules/seller-copilot/application/answer/modes/shop-data/products/resolve-product-stock-alerts.util';

interface SellerCopilotProfile {
    name: string;
    avatarUrl: string | null;
    email: string;
    phone: string | null;
    role: string;
    status: string;
}

interface SellerCopilotShopProfile {
    name: string;
    logoUrl?: string | null;
    description: string | null;
    businessModel: string;
    status: string;
}

const RETURN_REASON_CODES = new Set([
    'DAMAGED',
    'WRONG_ITEM',
    'MISSING_ITEM',
    'NOT_AS_DESCRIBED',
    'CHANGE_OF_MIND',
    'OTHER',
]);

// Lọc read model catalog từ Product Service trước khi tạo insight để dữ liệu thiếu không thành số/ảnh giả trên UI.
function normalizeProductCatalog(
    catalog: SellerCopilotProductCatalogSnapshot,
): SellerCopilotProductCatalogSnapshot['items'] {
    return catalog.items
        .filter((product) => product.productId.trim() && product.name.trim())
        .map((product) => ({
            ...product,
            description: product.description?.trim() || null,
            thumbnailUrl: product.thumbnailUrl?.trim() || null,
            availableTotal: Number.isFinite(product.availableTotal)
                ? product.availableTotal
                : 0,
            variants: product.variants
                .filter(
                    (variant) =>
                        variant.variantId.trim() &&
                        variant.name.trim() &&
                        Number.isFinite(variant.price) &&
                        Number.isFinite(variant.available) &&
                        variant.available >= 0 &&
                        Number.isFinite(variant.reserved) &&
                        variant.reserved >= 0,
                )
                .map((variant) => ({
                    ...variant,
                    options: variant.options.filter(
                        (option) => option.name.trim() && option.value.trim(),
                    ),
                    thumbnailUrl:
                        variant.thumbnailUrl?.trim() ||
                        product.thumbnailUrl?.trim() ||
                        null,
                })),
        }));
}

// Chỉ chuyển snapshot đơn hoàn chỉnh sang visual; item thiếu tên hoặc số liệu lỗi bị loại thay vì dựng thông tin giả.
function toSellerCopilotOrderInsight(
    order: SellerDashboardSnapshot['latestOrders'][number],
): SellerCopilotOrderInsight | null {
    if (
        !order.id.trim() ||
        !order.orderNumber.trim() ||
        !Number.isFinite(order.grossAmount) ||
        !Number.isFinite(order.itemCount) ||
        Number.isNaN(new Date(order.createdAt).getTime())
    ) {
        return null;
    }

    // Giữ ảnh snapshot từ Order Service; chỉ giới hạn số dòng hiển thị để context/card không phình theo đơn nhiều mặt hàng.
    const items = order.items
        .filter(
            (item) =>
                item.productId.trim() &&
                item.name.trim() &&
                Number.isFinite(item.quantity) &&
                item.quantity > 0 &&
                Number.isFinite(item.lineTotal) &&
                item.lineTotal >= 0,
        )
        .slice(0, 4)
        .map((item) => ({
            ...item,
            thumbnailUrl: item.thumbnailUrl?.trim() || null,
        }));

    return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        grossAmount: order.grossAmount,
        itemCount: order.itemCount,
        itemLineCount: order.itemLineCount,
        // Enum là allowlist cố định; description giới hạn độ dài vì đây là nội dung người mua nhập, không phải policy.
        returnReason:
            order.returnReason && RETURN_REASON_CODES.has(order.returnReason)
                ? order.returnReason
                : null,
        returnDescription:
            order.returnDescription?.trim().slice(0, 500) || null,
        cancelReason: order.cancelReason?.trim().slice(0, 500) || null,
        items,
        createdAt: order.createdAt,
    };
}

// Chỉ phát visual được model chọn khi dữ liệu thật có đủ trường tối thiểu; giá trị số và ảnh luôn lấy từ snapshot/profile.
// Visual doanh thu cần ít nhất hai điểm theo thời gian; sản phẩm cần ID/tên để tạo link an toàn; hồ sơ cần account đã tải.
// Nếu nguồn thiếu hoặc hỏng, bỏ đúng visual đó thay vì suy diễn, dựng placeholder giả hoặc làm hỏng toàn bộ câu trả lời.
export function buildSellerCopilotInsights(input: {
    visualizationTypes: SellerCopilotVisualizationType[];
    dashboard?: SellerDashboardSnapshot;
    productCatalog?: SellerCopilotProductCatalogSnapshot;
    account?: SellerCopilotProfile;
    shop: SellerCopilotShopProfile;
}): SellerCopilotInsight[] {
    const insights: SellerCopilotInsight[] = [];
    // Chuẩn hóa catalog một lần cho mọi visual trong cùng câu trả lời; tránh duyệt lặp và bảo đảm nhiều card dùng cùng tập record hợp lệ.
    const normalizedCatalog = input.productCatalog
        ? {
              ...input.productCatalog,
              items: normalizeProductCatalog(input.productCatalog),
          }
        : undefined;

    // Model chỉ chọn loại hiển thị; mỗi nhánh dưới đây tự xác minh payload và chỉ lấy số/ảnh từ snapshot backend.
    for (const visualizationType of input.visualizationTypes) {
        if (visualizationType === 'product_catalog' && normalizedCatalog) {
            // Catalog chỉ hiện từ Product Service; danh sách này không được dùng thay số bán theo kỳ từ Order Service.
            const items = normalizedCatalog.items;
            if (items.length) {
                insights.push({
                    type: 'PRODUCT_CATALOG',
                    items,
                    totalCount: normalizedCatalog.totalCount,
                    hasMore:
                        normalizedCatalog.hasMore ||
                        normalizedCatalog.totalCount > items.length,
                });
            }
            continue;
        }

        if (
            (visualizationType === 'low_stock' ||
                visualizationType === 'out_of_stock') &&
            normalizedCatalog
        ) {
            // Dùng chung phép lọc với answer context; model và card không thể áp dụng khác ngưỡng cho cùng snapshot.
            const matchingStock = resolveProductStockAlerts(
                normalizedCatalog,
                visualizationType,
            );

            // Hiển thị mọi biến thể khớp đến giới hạn an toàn, không chỉ biến thể thấp nhất rồi bỏ sót mặt hàng khác.
            insights.push(
                ...matchingStock.items.map((item) => ({
                    type: 'LOW_STOCK' as const,
                    productId: item.productId,
                    name: item.productName,
                    thumbnailUrl: item.thumbnailUrl,
                    stock: item.stock,
                    variantName: item.variantName,
                })),
            );
            continue;
        }

        if (visualizationType === 'stock_summary' && input.dashboard) {
            // Card nêu riêng số sản phẩm khác nhau có hàng và tổng đơn vị tồn để tránh nhập nhằng “sản phẩm” với “chiếc”.
            insights.push({
                type: 'PRODUCT_STOCK_SUMMARY',
                catalogProducts: input.dashboard.kpis.catalogProducts,
                activeProducts: input.dashboard.kpis.activeProducts,
                inStockProducts: input.dashboard.kpis.inStockProducts,
                stockUnits: input.dashboard.kpis.stockUnits,
            });
            continue;
        }

        if (visualizationType === 'revenue_trend' && input.dashboard) {
            // Loại ngày sai định dạng, doanh thu âm hoặc NaN để chart không nhận trục thời gian/giá trị không đáng tin.
            const points = input.dashboard.revenueTrend.filter(
                (point) =>
                    /^\d{4}-\d{2}-\d{2}$/u.test(point.date) &&
                    Number.isFinite(point.grossRevenue) &&
                    point.grossRevenue >= 0,
            );
            // Một điểm không tạo thành xu hướng; bỏ visual thay vì tự thêm điểm giả hoặc dựng đường phẳng gây hiểu nhầm.
            if (points.length >= 2) {
                const firstPoint = points[0];
                const lastPoint = points[points.length - 1];
                // Range biểu đồ dùng ngày nghiệp vụ Việt Nam từ chính chuỗi điểm,
                // không dùng instant ISO UTC của dashboard vì có thể lệch sang ngày hôm trước.
                if (!firstPoint || !lastPoint) continue;
                insights.push({
                    type: 'REVENUE_TREND',
                    range: {
                        from: firstPoint.date,
                        to: lastPoint.date,
                    },
                    points: points.map(({ date, grossRevenue }) => ({
                        date,
                        grossRevenue,
                    })),
                });
            }
            continue;
        }

        if (visualizationType === 'top_products' && input.dashboard) {
            // Chỉ xét sản phẩm có thông tin nhận diện và giao dịch trong kỳ; catalog/lifetime sales không được làm ứng viên top.
            const products = input.dashboard.topProducts
                .filter(
                    (product) =>
                        Boolean(product.productId.trim()) &&
                        Boolean(product.name.trim()) &&
                        Number.isFinite(product.quantitySold) &&
                        product.quantitySold > 0,
                )
                // Xếp theo số lượng bán thay vì giữ thứ tự trộn giữa order summary và catalog; doanh thu chỉ phá hòa.
                // Chọn đúng một phần tử vì insight này trả lời câu hỏi sản phẩm đứng đầu, không phải danh sách catalog.
                .sort((left, right) => {
                    const leftRevenue = left.revenue ?? 0;
                    const rightRevenue = right.revenue ?? 0;
                    // Giá trị thiếu/NaN không được thắng khi đồng số lượng; doanh thu hợp lệ chỉ dùng để phá hòa.
                    const revenueDifference =
                        (Number.isFinite(rightRevenue) ? rightRevenue : 0) -
                        (Number.isFinite(leftRevenue) ? leftRevenue : 0);
                    return (
                        right.quantitySold - left.quantitySold ||
                        revenueDifference
                    );
                })
                .slice(0, 1);
            insights.push(
                // Doanh thu sản phẩm có thể thiếu; chỉ trường này fallback null, còn số lượng bán giữ nguyên dữ liệu nguồn.
                ...products.map((product) => ({
                    type: 'PRODUCT_PERFORMANCE' as const,
                    productId: product.productId,
                    name: product.name,
                    thumbnailUrl: product.thumbnailUrl,
                    quantitySold: product.quantitySold,
                    revenue: Number.isFinite(product.revenue)
                        ? product.revenue
                        : null,
                })),
            );
            continue;
        }

        if (visualizationType === 'sold_products' && input.dashboard) {
            // Danh sách mặt hàng đã bán chỉ dùng aggregate theo kỳ từ Order Service; ranking này không chứa catalog chưa bán.
            const products = input.dashboard.topProducts
                .filter(
                    (product) =>
                        product.productId.trim() &&
                        product.name.trim() &&
                        Number.isFinite(product.quantitySold) &&
                        product.quantitySold > 0,
                )
                .sort((left, right) => {
                    // Revenue chỉ phá hòa khi cả hai sản phẩm cùng số lượng; null/NaN không được coi là doanh thu thật.
                    const leftRevenue =
                        typeof left.revenue === 'number' &&
                        Number.isFinite(left.revenue)
                            ? left.revenue
                            : 0;
                    const rightRevenue =
                        typeof right.revenue === 'number' &&
                        Number.isFinite(right.revenue)
                            ? right.revenue
                            : 0;
                    return (
                        right.quantitySold - left.quantitySold ||
                        rightRevenue - leftRevenue
                    );
                });
            insights.push(
                ...products.map((product) => ({
                    type: 'PRODUCT_PERFORMANCE' as const,
                    productId: product.productId,
                    name: product.name,
                    thumbnailUrl: product.thumbnailUrl,
                    quantitySold: product.quantitySold,
                    revenue: Number.isFinite(product.revenue)
                        ? product.revenue
                        : null,
                })),
            );
            continue;
        }

        if (
            visualizationType === 'products_without_revenue' &&
            input.dashboard &&
            normalizedCatalog
        ) {
            // Anti-join catalog với doanh thu dương từ Order Service trong cùng range; card chỉ nhận ảnh/tên Product Service.
            const result = resolveProductsWithoutRevenue({
                catalog: normalizedCatalog,
                completedSales: input.dashboard.topProducts,
                salesHasMore: input.dashboard.topProductsHasMore,
            });
            if (result?.items.length) {
                insights.push({
                    type: 'PRODUCTS_WITHOUT_REVENUE',
                    range: input.dashboard.range,
                    hasMore: result.hasMore,
                    items: result.items,
                });
            }
            continue;
        }

        if (visualizationType === 'completed_orders' && input.dashboard) {
            // Câu hỏi chỉ hỏi số lượng dùng aggregate toàn kỳ của dashboard; latestOrders bị giới hạn nên không thể dùng để đếm tổng.
            const completedCount = input.dashboard.orderStatusCounts.completed;
            if (Number.isInteger(completedCount) && completedCount >= 0) {
                insights.push({
                    type: 'ORDER_STATUS_COUNT',
                    fulfillmentStatus: 'COMPLETED',
                    count: completedCount,
                });
            }
            continue;
        }

        if (visualizationType === 'completed_order_list' && input.dashboard) {
            // Câu hỏi tiếp nối “đó là đơn nào” lấy riêng đơn COMPLETED, không lọc một mẫu latestOrders có thể thiếu đơn cũ.
            const orders = input.dashboard.completedOrders
                .map(toSellerCopilotOrderInsight)
                .filter(
                    (order): order is SellerCopilotOrderInsight =>
                        order !== null,
                );
            if (orders.length) {
                insights.push({
                    type: 'COMPLETED_ORDERS',
                    orders,
                    hasMore: input.dashboard.completedOrdersHasMore,
                });
            }
            continue;
        }

        if (visualizationType === 'actionable_orders' && input.dashboard) {
            // Hàng đợi đã được Order Service lọc và xếp ưu tiên; không thay bằng latestOrders vốn có thể toàn đơn hoàn tất.
            const orders = input.dashboard.actionableOrders
                .map(toSellerCopilotOrderInsight)
                .filter(
                    (order): order is SellerCopilotOrderInsight =>
                        order !== null,
                );
            if (orders.length) {
                insights.push({
                    type: 'ACTIONABLE_ORDERS',
                    orders,
                    hasMore: input.dashboard.actionableOrdersHasMore,
                });
            }
            continue;
        }

        if (visualizationType === 'cancelled_orders' && input.dashboard) {
            // Lý do hủy chỉ lấy từ cancel_reason của đơn CANCELLED; không dùng reason hoàn trả hoặc suy luận từ trạng thái.
            const orders = input.dashboard.cancelledOrders
                .map(toSellerCopilotOrderInsight)
                .filter(
                    (order): order is SellerCopilotOrderInsight =>
                        order !== null,
                );
            if (orders.length) {
                insights.push({
                    type: 'CANCELLED_ORDERS',
                    orders,
                    hasMore: input.dashboard.cancelledOrdersHasMore,
                });
            }
            continue;
        }

        if (visualizationType === 'delivered_orders' && input.dashboard) {
            // Danh sách giao thành công chỉ dùng đơn đã lọc theo DELIVERED, không suy ra từ đơn mới nhất.
            const orders = input.dashboard.deliveredOrders
                .map(toSellerCopilotOrderInsight)
                .filter(
                    (order): order is SellerCopilotOrderInsight =>
                        order !== null,
                );
            if (orders.length) {
                insights.push({
                    type: 'DELIVERED_ORDERS',
                    orders,
                    hasMore: input.dashboard.deliveredOrdersHasMore,
                });
            }
            continue;
        }

        if (
            (visualizationType === 'order_details' ||
                visualizationType === 'return_orders') &&
            input.dashboard
        ) {
            // Danh sách hoàn trả lấy từ truy vấn riêng để không bị lẫn với danh sách đơn mới nhất.
            const sourceOrders =
                visualizationType === 'return_orders'
                    ? input.dashboard.recentReturnOrders
                    : input.dashboard.latestOrders;
            const orders = sourceOrders
                .map(toSellerCopilotOrderInsight)
                .filter(
                    (order): order is SellerCopilotOrderInsight =>
                        order !== null,
                );

            // Không tạo khung rỗng nếu dashboard không có order phù hợp; phần answer có thể giải thích là hiện chưa có đơn.
            if (orders.length) {
                insights.push({
                    type:
                        visualizationType === 'return_orders'
                            ? 'RETURN_ORDERS'
                            : 'ORDER_DETAILS',
                    orders,
                    ...(visualizationType === 'return_orders'
                        ? {
                              hasMore:
                                  input.dashboard.recentReturnOrdersHasMore,
                          }
                        : {}),
                });
            }
            continue;
        }

        if (visualizationType === 'seller_profile' && input.account) {
            // Không tạo card profile nếu Auth Service chưa trả account; logo shop là ảnh riêng và được phép thiếu.
            insights.push({
                type: 'SELLER_PROFILE',
                account: input.account,
                shop: {
                    name: input.shop.name,
                    logoUrl: input.shop.logoUrl ?? null,
                    description: input.shop.description,
                    businessModel: input.shop.businessModel,
                    status: input.shop.status,
                },
            });
        }
    }

    return insights;
}
