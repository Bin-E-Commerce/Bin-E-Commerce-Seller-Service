// Nối “sản phẩm này” với một biến thể hết hàng đã được backend lưu trong cùng phiên Agent.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import type { SellerInventoryFollowUpResolution } from '@/modules/seller-copilot/application/modes/agent/types/seller-inventory-command.types';

const INVENTORY_TARGET_REFERENCE =
    /(?:^|\s)(?:sản phẩm|biến thể|mặt hàng)\s+(?:này|đó)(?=\s|[.,!?]|$)/iu;

// Chỉ dùng insight của assistant gần nhất thuộc phiên Agent hiện tại; thiếu ID/SKU hoặc nhiều kết quả thì fail closed.
export function resolveAgentInventoryFollowUp(input: {
    plan: SellerQuestionPlan;
    recentMessages: SellerCopilotMessageRecord[];
    modeSessionId: string;
    question: string;
}): SellerInventoryFollowUpResolution {
    const changeTasks = input.plan.tasks.filter(
        (task) => task.requestType === 'CHANGE_REQUEST',
    );
    const changeTask = changeTasks[0];

    // Follow-up chỉ hợp lệ cho đúng một lệnh inventory; không dùng insight tồn kho để gắn đích cho domain khác.
    if (
        input.plan.status !== 'READY' ||
        !INVENTORY_TARGET_REFERENCE.test(input.question) ||
        changeTasks.length !== 1 ||
        changeTask?.domain !== 'seller-products-inventory'
    ) {
        return { kind: 'not_applicable' };
    }

    // Chọn assistant gần nhất trong cùng mode session; không nhảy qua thông điệp mới hơn để tái dùng sản phẩm cũ.
    const previousAssistant = [...input.recentMessages]
        .reverse()
        .find(
            (message) =>
                message.role !== 'system' &&
                message.metadata?.interactionMode === 'agent' &&
                message.metadata.modeSessionId === input.modeSessionId,
        );
    if (previousAssistant?.role !== 'assistant') {
        return {
            kind: 'clarification',
            message:
                'Mình chưa xác định được biến thể bạn đang nhắc tới. Bạn gửi tên size hoặc SKU giúp mình nhé.',
        };
    }

    // Người dùng đã nêu tên/SKU cụ thể thì để inventory service tự tìm và xác minh; không ghi đè bằng referent cũ.
    const stockInsights = (previousAssistant.metadata?.insights ?? []).filter(
        (insight) => insight.type === 'LOW_STOCK',
    );
    const namedInsight = stockInsights.find((insight) =>
        [insight.name, insight.variantName, insight.sku, insight.sellerSku]
            .filter((value): value is string => Boolean(value?.trim()))
            .some((value) => includesProductReference(input.question, value)),
    );
    if (namedInsight) return { kind: 'not_applicable' };

    // Một card LOW_STOCK duy nhất là bằng chứng cho “này/đó”; nhiều card buộc seller chọn, không tự lấy card đầu tiên.
    if (stockInsights.length !== 1) {
        return {
            kind: 'clarification',
            message:
                'Tin nhắn trước có nhiều biến thể tồn thấp. Bạn gửi đúng tên biến thể hoặc SKU muốn chỉnh nhé.',
        };
    }

    const insight = stockInsights[0];
    if (
        !insight?.productId.trim() ||
        !insight.name.trim() ||
        !insight.variantId?.trim() ||
        !insight.variantName?.trim() ||
        !insight.sku?.trim()
    ) {
        return {
            kind: 'clarification',
            message:
                'Biến thể ở câu trước chưa đủ mã để xác minh an toàn. Bạn gửi SKU của sản phẩm giúp mình nhé.',
        };
    }

    return {
        kind: 'resolved',
        target: {
            productId: insight.productId,
            productName: insight.name,
            variantId: insight.variantId,
            variantName: insight.variantName,
            sku: insight.sku,
            sellerSku: insight.sellerSku ?? null,
        },
    };
}

// Tên SKU nhiều ký tự có thể khớp một phần; size ngắn như “S/M/L” chỉ khớp khi là token độc lập.
function includesProductReference(
    question: string,
    reference: string,
): boolean {
    const normalizedQuestion = question.toLocaleLowerCase('vi');
    const normalizedReference = reference.trim().toLocaleLowerCase('vi');
    if (normalizedReference.length > 2) {
        return normalizedQuestion.includes(normalizedReference);
    }

    const questionTokens = normalizedQuestion.split(/[^\p{L}\p{N}-]+/u);
    return questionTokens.includes(normalizedReference);
}
