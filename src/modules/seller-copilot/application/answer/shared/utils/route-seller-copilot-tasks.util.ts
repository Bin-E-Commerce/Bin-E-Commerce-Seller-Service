// Phân nhóm task theo registry capability đã được xác thực; không suy đoán domain bằng keyword hay nội dung câu trả lời.
import type { SellerCopilotInteractionMode } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { SellerKnowledgeDomainKind } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import type {
    SellerQuestionPlan,
    SellerQuestionTask,
} from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

// Kết quả giữ nguyên task gốc và các tập con cần cho việc chọn backend/context ở những bước tiếp theo.
export interface SellerCopilotTaskRouting {
    answerTasks: SellerQuestionTask[];
    routedTasks: SellerQuestionTask[];
    knowledgeTasks: SellerQuestionTask[];
    liveTasks: SellerQuestionTask[];
    profileTasks: SellerQuestionTask[];
    unresolvedTasks: SellerQuestionTask[];
    wrongSourceTasks: SellerQuestionTask[];
    hasProductQuestion: boolean;
    hasOrderQuestion: boolean;
    hasProfileQuestion: boolean;
    originalQuestion: string;
    canRetryWithOriginalQuestion: boolean;
}

// Chia task theo nguồn đăng ký và mode trước mọi I/O; task thiếu route được giữ riêng để caller fail-closed.
export function routeSellerCopilotTasks(input: {
    plan: SellerQuestionPlan;
    answerTasks: SellerQuestionTask[];
    domainKinds: Map<string, SellerKnowledgeDomainKind>;
    interactionMode: SellerCopilotInteractionMode;
    originalQuestion: string;
}): SellerCopilotTaskRouting {
    // Task mutation không đi vào answer pipeline; small talk không cần tra domain.
    const { plan, answerTasks, domainKinds, interactionMode } = input;
    const routedTasks = answerTasks.filter(
        (task) => task.requestType !== 'SMALL_TALK',
    );

    // Chỉ domain có registry kind tương ứng mới được chuyển đến retrieval/live/profile adapter.
    const knowledgeTasks = routedTasks.filter(
        (task) => domainKinds.get(task.domain ?? '') === 'knowledge',
    );
    const liveTasks = routedTasks.filter(
        (task) => domainKinds.get(task.domain ?? '') === 'live-data',
    );
    const profileTasks = routedTasks.filter(
        (task) => domainKinds.get(task.domain ?? '') === 'profile',
    );
    const unresolvedTasks = routedTasks.filter(
        (task) => !domainKinds.has(task.domain ?? ''),
    );

    // Knowledge chỉ nhận tài liệu, shop_data nhận live/profile; chat và agent được điều phối qua nhánh riêng bên ngoài.
    const wrongSourceTasks =
        interactionMode === 'knowledge'
            ? routedTasks.filter(
                  (task) => domainKinds.get(task.domain ?? '') !== 'knowledge',
              )
            : interactionMode === 'shop_data'
              ? routedTasks.filter((task) => {
                    const sourceKind = domainKinds.get(task.domain ?? '');
                    return sourceKind !== 'live-data' && sourceKind !== 'profile';
                })
              : [];

    const originalQuestion = input.originalQuestion.trim();

    // Chỉ thử lại câu gốc cho một chủ đề mới có đúng một task knowledge đã được planner route.
    // Follow-up thường là cụm thiếu chủ ngữ nên không thể dùng nguyên văn làm truy vấn evidence dự phòng.
    const canRetryWithOriginalQuestion =
        plan.contextRelation === 'NEW_TOPIC' &&
        knowledgeTasks.length === 1 &&
        Boolean(originalQuestion) &&
        knowledgeTasks[0]?.resolvedQuestion.trim() !== originalQuestion;

    return {
        answerTasks,
        routedTasks,
        knowledgeTasks,
        liveTasks,
        profileTasks,
        unresolvedTasks,
        wrongSourceTasks,
        hasProductQuestion: answerTasks.some(
            (task) => task.domain === 'seller-products-inventory',
        ),
        hasOrderQuestion: answerTasks.some(
            (task) => task.domain === 'seller-orders',
        ),
        hasProfileQuestion: answerTasks.some(
            (task) => task.domain === 'seller-profile',
        ),
        originalQuestion,
        canRetryWithOriginalQuestion,
    };
}
