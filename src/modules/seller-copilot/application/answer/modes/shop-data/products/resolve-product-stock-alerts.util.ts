// Chọn một tập biến thể tồn kho có cảnh báo để phần trả lời và card dùng cùng nguồn sự thật.
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Lọc biến thể từ catalog đã được Product Service giới hạn theo shop; dữ liệu thiếu không được biến thành cảnh báo giả.
export function resolveProductStockAlerts(
    catalog: SellerCopilotProductCatalogSnapshot,
    kind: 'low_stock' | 'out_of_stock',
) {
    // Bỏ qua product/variant không đủ định danh hoặc tồn kho không hợp lệ trước khi xét ngưỡng nghiệp vụ.
    const matches = catalog.items.flatMap((product) => {
        if (!product.productId.trim() || !product.name.trim()) return [];

        return product.variants
            .filter((variant) => {
                if (
                    !variant.variantId.trim() ||
                    !variant.name.trim() ||
                    !Number.isFinite(variant.available) ||
                    variant.available < 0
                ) {
                    return false;
                }

                // Hết hàng là khả dụng đúng 0; sắp hết hàng là số dương không vượt ngưỡng để hai nhãn không chồng lấn.
                return kind === 'out_of_stock'
                    ? variant.available === 0
                    : variant.available > 0 &&
                          Number.isFinite(variant.lowStockThreshold) &&
                          variant.available <= variant.lowStockThreshold;
            })
            .map((variant) => ({
                productId: product.productId,
                productName: product.name,
                thumbnailUrl:
                    variant.thumbnailUrl ?? product.thumbnailUrl ?? null,
                stock: variant.available,
                variantName: variant.name,
            }));
    });

    // Ưu tiên biến thể ít hàng trước; snapshot bị phân trang được đánh dấu chưa đầy đủ để answer không kết luận toàn shop.
    const sortedMatches = matches.sort((left, right) => left.stock - right.stock);
    return {
        items: sortedMatches.slice(0, 10),
        hasMore:
            sortedMatches.length > 10 ||
            catalog.hasMore ||
            catalog.items.some((product) => product.hasMoreVariants),
    };
}
