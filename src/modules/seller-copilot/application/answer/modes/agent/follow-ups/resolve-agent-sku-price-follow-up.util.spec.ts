import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { resolveAgentSkuPriceFollowUp } from '@/modules/seller-copilot/application/answer/modes/agent/follow-ups/resolve-agent-sku-price-follow-up.util';

describe('resolveAgentSkuPriceFollowUp', () => {
    const plan: SellerQuestionPlan = {
        status: 'READY',
        contextRelation: 'FOLLOW_UP',
        tasks: [
            {
                requestType: 'CHANGE_REQUEST',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Đổi giá SKU đó thành 199000 đồng.',
            },
        ],
        clarificationQuestion: null,
        failureReason: null,
    };
    const message: SellerCopilotMessageRecord = {
        id: 'assistant-1',
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Thông tin sản phẩm đã tra cứu.',
        metadata: {
            interactionMode: 'agent',
            modeSessionId: 'session-1',
            insights: [
                {
                    type: 'PRODUCT_CATALOG',
                    items: [
                        {
                            productId: 'product-1',
                            isShopLinked: true,
                            name: 'Áo thun thể thao',
                            description: 'Mô tả sản phẩm',
                            thumbnailUrl: null,
                            status: 'ACTIVE',
                            totalSold: 2,
                            availableTotal: 4,
                            variantCount: 1,
                            hasMoreVariants: false,
                            variants: [
                                {
                                    variantId: 'variant-1',
                                    name: 'Đen / M',
                                    sku: 'SKU-BLACK-M',
                                    sellerSku: null,
                                    options: [],
                                    price: 100000,
                                    originalPrice: null,
                                    available: 4,
                                    reserved: 0,
                                    quantitySold: 2,
                                    lowStockThreshold: 5,
                                    thumbnailUrl: null,
                                },
                            ],
                        },
                    ],
                    hasMore: false,
                    totalCount: 1,
                },
            ],
        },
        createdAt: new Date('2026-10-07T00:00:00.000Z'),
    };

    // SKU chỉ được tự nối khi cùng mode/session và card đã chứng minh đúng một sản phẩm, một biến thể shop-linked.
    it('resolves a unique SKU reference from a previous Agent catalog insight', () => {
        const result = resolveAgentSkuPriceFollowUp({
            plan,
            recentMessages: [message],
            modeSessionId: 'session-1',
            question: 'Đổi giá SKU đó thành 199.000đ',
        });

        expect(result.tasks[0]?.resolvedQuestion).toBe(
            'Đổi giá SKU SKU-BLACK-M thành 199.000đ.',
        );
    });

    // Không tự đoán SKU nếu phiên trước có nhiều biến thể để tránh sửa nhầm giá.
    it('keeps the follow-up unresolved when the prior catalog has multiple variants', () => {
        const productInsight = message.metadata?.insights?.[0];
        if (productInsight?.type !== 'PRODUCT_CATALOG') return;
        const multipleVariants: SellerCopilotMessageRecord = {
            ...message,
            metadata: {
                ...message.metadata,
                insights: [
                    {
                        ...productInsight,
                        items: [
                            {
                                ...productInsight.items[0]!,
                                variants: [
                                    ...productInsight.items[0]!.variants,
                                    {
                                        ...productInsight.items[0]!
                                            .variants[0]!,
                                        variantId: 'variant-2',
                                        sku: 'SKU-BLACK-L',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        };

        const result = resolveAgentSkuPriceFollowUp({
            plan,
            recentMessages: [multipleVariants],
            modeSessionId: 'session-1',
            question: 'Đổi giá SKU đó thành 199.000đ',
        });

        expect(result).toBe(plan);
    });
});
