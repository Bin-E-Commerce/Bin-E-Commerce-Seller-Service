// Regression cho phép đối chiếu catalog với aggregate bán hoàn tất mà không khẳng định trên dữ liệu bị giới hạn.
import { resolveProductsWithoutRevenue } from '@/modules/seller-copilot/application/answer/modes/shop-data/products/resolve-products-without-revenue.util';

describe('resolveProductsWithoutRevenue', () => {
    // Sản phẩm không có giao dịch và giao dịch doanh thu bằng 0 được liệt kê; doanh thu thiếu không bị kết luận là 0.
    it('returns only products whose completed-sales revenue is verifiably absent or zero', () => {
        const result = resolveProductsWithoutRevenue({
            catalog: {
                totalCount: 4,
                hasMore: false,
                items: [
                    {
                        productId: 'positive',
                        name: 'Có doanh thu',
                        thumbnailUrl: null,
                    },
                    {
                        productId: 'missing',
                        name: 'Chưa phát sinh',
                        thumbnailUrl: null,
                    },
                    {
                        productId: 'zero',
                        name: 'Doanh thu bằng 0',
                        thumbnailUrl: null,
                    },
                    {
                        productId: 'unknown',
                        name: 'Thiếu aggregate',
                        thumbnailUrl: null,
                    },
                ],
            } as never,
            completedSales: [
                { productId: 'positive', revenue: 25000 },
                { productId: 'zero', revenue: 0 },
                { productId: 'unknown', revenue: null },
            ],
            salesHasMore: false,
        });

        expect(result).toEqual({
            hasMore: false,
            items: [
                {
                    productId: 'missing',
                    name: 'Chưa phát sinh',
                    thumbnailUrl: null,
                },
                {
                    productId: 'zero',
                    name: 'Doanh thu bằng 0',
                    thumbnailUrl: null,
                },
            ],
        });
    });

    // Nếu order aggregate vượt giới hạn thì mọi sản phẩm không thấy trong top có thể vẫn bán được, nên không trả kết luận.
    it('returns null when the completed-sales aggregate is truncated', () => {
        const result = resolveProductsWithoutRevenue({
            catalog: { items: [], totalCount: 0, hasMore: false },
            completedSales: [],
            salesHasMore: true,
        });

        expect(result).toBeNull();
    });
});
