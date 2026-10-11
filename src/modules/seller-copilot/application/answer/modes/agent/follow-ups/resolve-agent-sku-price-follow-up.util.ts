// Nối tham chiếu SKU mơ hồ chỉ khi insight backend của cùng phiên Agent chỉ ra đúng một biến thể shop.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

// Chuẩn hóa câu đổi giá bằng SKU thật từ card có cấu trúc; không trích đối tượng từ văn xuôi do model sinh.
export function resolveAgentSkuPriceFollowUp(input: {
    plan: SellerQuestionPlan;
    recentMessages: SellerCopilotMessageRecord[];
    modeSessionId: string;
    question: string;
}): SellerQuestionPlan {
    const changeTasks = input.plan.tasks.filter(
        (task) => task.requestType === 'CHANGE_REQUEST',
    );
    const task = changeTasks[0];

    // Chỉ một thay đổi giá theo sau mới cần nối SKU; thao tác khác hoặc nhiều write luôn giữ nguyên để hỏi rõ.
    if (
        input.plan.contextRelation !== 'FOLLOW_UP' ||
        changeTasks.length !== 1 ||
        task?.domain !== 'seller-products-inventory' ||
        !/(?:đổi|chỉnh|cập nhật)\s+giá/iu.test(input.question) ||
        !/(?:sku|mã\s*(?:sku|phân loại))\s+(?:đó|này|vừa nêu|ở trên)/iu.test(
            input.question,
        ) ||
        /(?:sku|mã\s*(?:sku|phân loại))\s+(?!đó\b|này\b)([a-z0-9][a-z0-9_-]{2,})/iu.test(
            task.resolvedQuestion,
        )
    ) {
        return input.plan;
    }

    // Chỉ lấy assistant gần nhất cùng mode session; không nhảy qua một câu trả lời khác để tái dùng SKU cũ.
    const previousAssistant = [...input.recentMessages]
        .reverse()
        .find(
            (message) =>
                message.role !== 'system' &&
                message.metadata?.modeSessionId === input.modeSessionId &&
                message.metadata?.interactionMode === 'agent',
        );
    if (previousAssistant?.role !== 'assistant') return input.plan;

    // Một sản phẩm với một biến thể shop-linked là ranh giới duy nhất đủ an toàn để hiểu “SKU đó”.
    const productInsight = previousAssistant.metadata?.insights?.find(
        (insight) => insight.type === 'PRODUCT_CATALOG',
    );
    if (
        productInsight?.type !== 'PRODUCT_CATALOG' ||
        productInsight.items.length !== 1
    ) {
        return input.plan;
    }
    const product = productInsight.items[0];
    const variant = product?.variants.length === 1 ? product.variants[0] : null;
    const sku = variant?.sellerSku?.trim() || variant?.sku.trim();
    if (!product?.isShopLinked || !sku) return input.plan;

    // Giữ nguyên con số/đơn vị người bán nhập; nếu không có giá rõ ràng thì downstream vẫn hỏi lại thay vì đoán.
    const price = input.question.match(
        /(?:thành|là|về|=)\s*([\d.,]+\s*(?:đ|vnd)?)/iu,
    )?.[1];
    if (!price) return input.plan;

    return {
        ...input.plan,
        tasks: input.plan.tasks.map((currentTask) =>
            currentTask === task
                ? {
                      ...currentTask,
                      resolvedQuestion: `Đổi giá SKU ${sku} thành ${price.trim()}.`,
                  }
                : currentTask,
        ),
    };
}
