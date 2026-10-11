import { SellerProductAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-product-agent.service';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type { SellerOrderSalesClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-order-sales.client';

describe('SellerProductAgentService', () => {
    let client: {
        getLowStockVariants: jest.Mock;
        getActiveVariantPage: jest.Mock;
    };
    let salesClient: { getVariantSales: jest.Mock };
    let repository: { createActionProposal: jest.Mock };
    let target: SellerProductAgentService;

    // Mocks cô lập phép tính đề xuất và persistence proposal khỏi Product Service/DB thật.
    beforeEach(() => {
        client = {
            getLowStockVariants: jest.fn().mockResolvedValue([
                {
                    productId: 'product-1',
                    productName: 'Áo thun',
                    variantId: 'variant-1',
                    variantName: 'M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    available: 2,
                    reserved: 1,
                    lowStockThreshold: 5,
                },
            ]),
            getActiveVariantPage: jest.fn().mockResolvedValue({
                items: [
                    {
                        productId: 'product-1',
                        productName: 'Áo thun',
                        variantId: 'variant-1',
                        variantName: 'Đen / M',
                        sku: 'SKU-1',
                        sellerSku: null,
                        price: 200000,
                        available: 12,
                    },
                ],
                hasMore: false,
            }),
        };
        salesClient = {
            getVariantSales: jest.fn().mockResolvedValue(
                new Map([['variant-1', 2]]),
            ),
        };
        repository = {
            createActionProposal: jest
                .fn()
                .mockImplementation(async (input) => ({
                    id: 'proposal-1',
                    ...input,
                    batchId: input.batchId,
                    status: 'pending',
                })),
        };
        target = new SellerProductAgentService(
            client as unknown as SellerInventoryAgentClient,
            salesClient as unknown as SellerOrderSalesClient,
            repository as unknown as SellerCopilotRepositoryPort,
        );
    });

    // Ngưỡng được lấy từ Product Service; target mặc định gấp đôi ngưỡng và chỉ tạo proposal, chưa gọi API ghi.
    it('creates an independently confirmable two-threshold replenishment proposal', async () => {
        const result = await target.prepareLowStock({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
        });

        expect(result.kind).toBe('proposals');
        if (result.kind !== 'proposals') return;
        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0]?.payload).toMatchObject({
            kind: 'SET_INVENTORY',
            expectedAvailable: 2,
            nextAvailable: 10,
            lowStockThreshold: 5,
            recommendationReason: 'LOW_STOCK',
        });
        expect(repository.createActionProposal).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerUserId: 'owner-1',
                shopId: 'shop-1',
                batchId: result.batchId,
            }),
        );
    });

    // Shop phải được quét đầy đủ trước khi báo cáo; batch lớn hơn giới hạn được hỏi lọc thay vì âm thầm bỏ bớt dòng.
    it('asks the seller to narrow an oversized low-stock batch without saving partial proposals', async () => {
        client.getLowStockVariants.mockResolvedValue(
            Array.from({ length: 51 }, (_, index) => ({
                productId: `product-${index}`,
                productName: `Product ${index}`,
                variantId: `variant-${index}`,
                variantName: 'Default',
                sku: `SKU-${index}`,
                sellerSku: null,
                available: 1,
                reserved: 0,
                lowStockThreshold: 5,
            })),
        );

        const result = await target.prepareLowStock({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
        });

        expect(result.kind).toBe('clarification');
        expect(repository.createActionProposal).not.toHaveBeenCalled();
    });

    // Chỉ SKU đạt đồng thời ngưỡng tồn/số bán mới thành proposal; giá sàn thay giá tính theo % khi cần.
    it('creates a slow-moving price preview with the measured discount and minimum price', async () => {
        const result = await target.prepareSlowMovingPriceChange({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@xả-hàng tồn ít nhất 10, bán tối đa 2 trong 30 ngày, giảm 10%, giá sàn 185.000đ',
        });

        expect(result.kind).toBe('proposals');
        if (result.kind !== 'proposals') return;
        expect(result.proposals).toHaveLength(1);
        expect(result.proposals[0]?.payload).toMatchObject({
            kind: 'SET_VARIANT_PRICE',
            expectedPrice: 200000,
            nextPrice: 185000,
            minimumPrice: 185000,
            priceRecommendation: {
                kind: 'SLOW_MOVING_CLEARANCE',
                available: 12,
                quantitySold: 2,
                periodDays: 30,
                requestedDiscountPercent: 10,
                effectiveDiscountPercent: 7.5,
            },
        });
        expect(salesClient.getVariantSales).toHaveBeenCalledWith(
            expect.objectContaining({
                shopId: 'shop-1',
                variantIds: ['variant-1'],
            }),
        );
    });

    // Cách diễn đạt giá sàn trong ảnh vẫn phải được bóc tách để service không hỏi lại dữ liệu người bán đã cung cấp.
    it('parses a price floor phrased as not allowed to go below the amount', async () => {
        const result = await target.prepareSlowMovingPriceChange({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@xả-hàng Tìm SKU đang bán, còn ít nhất 10 sản phẩm và bán tối đa 2 trong 30 ngày qua. Đề xuất giảm giá 10%, giá sau giảm không được thấp hơn 150.000đ. Tạo bản xem trước, chưa áp dụng.',
        });

        expect(result.kind).toBe('proposals');
        if (result.kind !== 'proposals') return;
        expect(result.proposals[0]?.payload).toMatchObject({
            kind: 'SET_VARIANT_PRICE',
            minimumPrice: 150000,
            priceRecommendation: {
                requestedDiscountPercent: 10,
                periodDays: 30,
            },
        });
    });

    // Kỳ seller vừa trả lời phải ghi đè kỳ sai trước đó trong khi các bộ lọc còn lại được kế thừa.
    it('uses a clarified period with the criteria from the prior clearance request', async () => {
        client.getActiveVariantPage.mockResolvedValue({
            items: [
                {
                    productId: 'product-1',
                    productName: 'Áo thun',
                    variantId: 'variant-1',
                    variantName: 'Đen / M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    price: 200000,
                    available: 25,
                },
            ],
            hasMore: false,
        });
        salesClient.getVariantSales.mockResolvedValue(
            new Map([['variant-1', 1]]),
        );
        const result = await target.prepareSlowMovingPriceChange({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            contextMessages: [
                '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
            ],
            message: 'trong 90 ngày',
        });

        expect(result.kind).toBe('proposals');
        if (result.kind !== 'proposals') return;
        expect(result.proposals[0]?.payload).toMatchObject({
            priceRecommendation: {
                available: 25,
                quantitySold: 1,
                periodDays: 90,
            },
        });
        expect(salesClient.getVariantSales).toHaveBeenCalledWith(
            expect.objectContaining({
                from: expect.any(Date),
                to: expect.any(Date),
            }),
        );
    });

    // Thiếu bất kỳ điều kiện giảm giá nào thì phải hỏi trước, không gọi catalog hay lưu một phần proposal.
    it('asks for missing clearance criteria without loading products or saving proposals', async () => {
        const result = await target.prepareSlowMovingPriceChange({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: '@xả-hàng tìm hàng bán chậm',
        });

        expect(result.kind).toBe('clarification');
        expect(client.getActiveVariantPage).not.toHaveBeenCalled();
        expect(salesClient.getVariantSales).not.toHaveBeenCalled();
        expect(repository.createActionProposal).not.toHaveBeenCalled();
    });

    // SKU có giá bằng giá sàn bị loại khỏi proposal nhưng phải nêu đúng tên/lý do, không báo nhầm là không có hàng phù hợp.
    it('explains when every slow-moving candidate is already at the price floor', async () => {
        client.getActiveVariantPage.mockResolvedValue({
            items: [
                {
                    productId: 'product-1',
                    productName: 'Áo thun',
                    variantId: 'variant-1',
                    variantName: 'Đen / M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    price: 150000,
                    available: 12,
                },
            ],
            hasMore: false,
        });

        const result = await target.prepareSlowMovingPriceChange({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@xả-hàng tồn ít nhất 10, bán tối đa 2 trong 30 ngày, giảm 10%, giá sàn 150.000đ',
        });

        expect(result).toMatchObject({
            kind: 'clarification',
            message: expect.stringContaining('Áo thun — Đen / M'),
        });
        expect(repository.createActionProposal).not.toHaveBeenCalled();
    });
});
