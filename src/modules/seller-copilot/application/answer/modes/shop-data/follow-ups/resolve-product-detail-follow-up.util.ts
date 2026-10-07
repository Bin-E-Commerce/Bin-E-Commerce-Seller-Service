// Giải quyết câu hỏi chi tiết sản phẩm dựa trên insight có cấu trúc của chính lượt trước trong cùng mode session.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type {
    SellerQuestionPlan,
    SellerQuestionTask,
} from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

// Chọn tên/ID chỉ từ insight backend đã lưu, không trích entity product từ đoạn văn do model sinh.
function getRecentProductInsight(
    recentMessages: SellerCopilotMessageRecord[],
    modeSessionId: string,
): { productId: string; name: string } | null {
    const latestMessage = [...recentMessages]
        .reverse()
        .find(
            (message) =>
                message.role !== 'system' &&
                message.metadata?.modeSessionId === modeSessionId &&
                message.metadata?.interactionMode === 'shop_data',
        );

    // Chỉ câu assistant gần nhất là antecedent hợp lệ; không nhảy qua chủ đề mới để dùng nhầm một sản phẩm cũ.
    if (latestMessage?.role !== 'assistant') return null;

    const insights = latestMessage.metadata?.insights ?? [];
    const performanceInsights = insights.filter(
        (insight) => insight.type === 'PRODUCT_PERFORMANCE',
    );
    if (performanceInsights.length === 1) {
        const product = performanceInsights[0];
        if (product?.productId.trim() && product.name.trim()) {
            return { productId: product.productId, name: product.name };
        }
    }
    if (performanceInsights.length > 1) return null;

    for (const insight of insights) {
        // Danh mục chỉ xác định được “sản phẩm này” khi card có đúng một sản phẩm; danh sách nhiều món mơ hồ thì fail closed.
        if (insight.type === 'PRODUCT_CATALOG' && insight.items.length === 1) {
            const product = insight.items[0];
            if (product?.productId.trim() && product.name.trim()) {
                return { productId: product.productId, name: product.name };
            }
        }
    }

    return null;
}

// Sửa route follow-up chi tiết dựa trên insight sản phẩm ngay trước câu hiện tại; registry vẫn chốt quyền truy cập sau bước này.
export function resolveProductDetailFollowUp(input: {
    plan: SellerQuestionPlan;
    recentMessages: SellerCopilotMessageRecord[];
    modeSessionId: string;
}): SellerQuestionPlan {
    const previousTask = input.plan.tasks[0];

    // Chỉ dùng contextRelation và intent đã qua validator; câu chữ tự do không thể tự biến một chủ đề mới thành follow-up.
    if (
        input.plan.tasks.length !== 1 ||
        input.plan.tasks.some(
            (task) => task.requestType === 'CHANGE_REQUEST',
        ) ||
        input.plan.contextRelation !== 'FOLLOW_UP' ||
        !previousTask ||
        previousTask.requestType !== 'READ_QUERY' ||
        previousTask.shopDataIntent !== 'product_detail'
    ) {
        return input.plan;
    }

    const product = getRecentProductInsight(
        input.recentMessages,
        input.modeSessionId,
    );
    if (!product) return input.plan;

    // Giữ nguyên task identity/plan metadata, chỉ làm rõ referent và nguồn đã được chứng minh ở lượt trước.
    const task: SellerQuestionTask = {
        ...previousTask,
        requestType: 'READ_QUERY',
        domain: 'seller-products-inventory',
        shopDataIntent: 'product_detail',
        productId: product.productId,
        resolvedQuestion: `Thông tin chi tiết sản phẩm "${product.name}" (productId: ${product.productId}).`,
    };
    // Planner có thể tạo task thừa hoặc hỏi làm rõ sai domain; insight đã xác thực làm rõ referent nên thay bằng một query xác định.
    return {
        ...input.plan,
        status: 'READY',
        clarificationQuestion: null,
        failureReason: null,
        tasks: [task],
    };
}
