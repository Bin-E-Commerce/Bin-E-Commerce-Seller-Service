// Kiểm tra follow-up sản phẩm dùng insight có cấu trúc cùng mode session, không phụ thuộc câu chữ assistant.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { resolveProductDetailFollowUp } from '@/modules/seller-copilot/application/answer/modes/shop-data/follow-ups/resolve-product-detail-follow-up.util';

describe('resolveProductDetailFollowUp', () => {
    const plan: SellerQuestionPlan = {
        status: 'READY',
        contextRelation: 'FOLLOW_UP',
        tasks: [
            {
                requestType: 'READ_QUERY',
                domain: 'seller-products-inventory',
                resolvedQuestion: 'Chi tiết sản phẩm này',
                shopDataIntent: 'product_detail',
            },
        ],
        clarificationQuestion: null,
        failureReason: null,
    };

    const previousMessage: SellerCopilotMessageRecord = {
        id: 'assistant-1',
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Sản phẩm bán chạy nhất là Áo thể thao.',
        metadata: {
            interactionMode: 'shop_data',
            modeSessionId: 'session-1',
            insights: [
                {
                    type: 'PRODUCT_PERFORMANCE',
                    productId: 'product-1',
                    name: 'Áo thể thao',
                    thumbnailUrl: null,
                    quantitySold: 3,
                    revenue: 555000,
                },
            ],
        },
        createdAt: new Date('2026-10-06T00:00:00.000Z'),
    };

    // Planner intent + quan hệ follow-up chọn sản phẩm từ insight có cấu trúc; không cần dò từ khóa trong câu hiện tại.
    it('routes a structured product-detail follow-up to the product live-data source', () => {
        // Arrange / Act
        const result = resolveProductDetailFollowUp({
            plan,
            recentMessages: [previousMessage],
            modeSessionId: 'session-1',
        });

        // Assert
        expect(result.tasks[0]).toMatchObject({
            requestType: 'READ_QUERY',
            domain: 'seller-products-inventory',
            shopDataIntent: 'product_detail',
            productId: 'product-1',
            resolvedQuestion:
                'Thông tin chi tiết sản phẩm "Áo thể thao" (productId: product-1).',
        });
    });

    // Không được dùng insight từ mode/session khác vì sản phẩm đó không còn là đối tượng hiện hành.
    it('does not inherit product details across mode sessions', () => {
        // Arrange / Act
        const result = resolveProductDetailFollowUp({
            plan,
            recentMessages: [previousMessage],
            modeSessionId: 'other-session',
        });

        // Assert
        expect(result).toBe(plan);
    });

    // Câu nhiều ý không bị viết lại theo product cũ dù một task nhắc tới chi tiết.
    it('keeps multi-task plans unchanged', () => {
        // Arrange / Act
        const result = resolveProductDetailFollowUp({
            plan: { ...plan, tasks: [...plan.tasks, ...plan.tasks] },
            recentMessages: [previousMessage],
            modeSessionId: 'session-1',
        });

        // Assert
        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0]?.domain).toBe('seller-products-inventory');
    });

    // Chủ đề mới không được lấy nhầm sản phẩm trước dù planner chọn cùng loại detail.
    it('does not inherit a product insight for a new topic', () => {
        const newTopicPlan: SellerQuestionPlan = {
            ...plan,
            contextRelation: 'NEW_TOPIC',
        };
        const result = resolveProductDetailFollowUp({
            plan: newTopicPlan,
            recentMessages: [previousMessage],
            modeSessionId: 'session-1',
        });

        expect(result).toBe(newTopicPlan);
        expect(result.tasks[0]).not.toHaveProperty('productId');
    });
});
