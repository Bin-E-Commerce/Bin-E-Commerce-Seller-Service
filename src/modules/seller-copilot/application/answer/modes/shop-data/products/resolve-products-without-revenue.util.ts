// Tạo phần bù catalog so với aggregate doanh thu đơn hoàn tất; answer và insight dùng chung cùng một phép đối chiếu.
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Chỉ khẳng định không doanh thu khi aggregate đầy đủ; product có doanh thu lỗi/thiếu bị loại khỏi kết luận để tránh gắn nhãn sai.
export function resolveProductsWithoutRevenue(input: {
    catalog: SellerCopilotProductCatalogSnapshot;
    completedSales: Array<{
        productId: string;
        revenue?: number | null;
    }>;
    salesHasMore: boolean;
}): {
    items: Array<{
        productId: string;
        name: string;
        thumbnailUrl: string | null;
    }>;
    hasMore: boolean;
} | null {
    // Top list chạm giới hạn thì không biết các sản phẩm chưa trả về có phát sinh doanh thu hay không.
    if (input.salesHasMore) return null;

    const revenueByProductId = new Map(
        input.completedSales.map((product) => [
            product.productId,
            product.revenue,
        ]),
    );
    const items = input.catalog.items
        .filter((product) => {
            if (!product.productId.trim() || !product.name.trim()) return false;
            if (!revenueByProductId.has(product.productId)) return true;

            // Chỉ giá trị 0 hợp lệ chứng minh sản phẩm có giao dịch nhưng không tạo doanh thu; thiếu/NaN là chưa xác định.
            const revenue = revenueByProductId.get(product.productId);
            return (
                typeof revenue === 'number' &&
                Number.isFinite(revenue) &&
                revenue === 0
            );
        })
        .map(({ productId, name, thumbnailUrl }) => ({
            productId,
            name,
            thumbnailUrl,
        }));

    return { items, hasMore: input.catalog.hasMore };
}
