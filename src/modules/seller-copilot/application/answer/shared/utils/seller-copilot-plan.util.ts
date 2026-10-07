// Chính sách phản hồi theo trạng thái planner và telemetry không chứa nội dung riêng tư.
import type { Logger } from '@nestjs/common';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

const TEMPORARILY_UNAVAILABLE_MESSAGE =
    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂';
const AI_UNAVAILABLE_MESSAGE =
    'Hiện tại trợ lý AI chưa sẵn sàng. Bạn quay lại sau giúp mình nhé 🙂';
const CHAT_PLANNER_UNAVAILABLE_MESSAGE =
    'Mình chưa phân loại được câu hỏi lúc này. Nếu bạn muốn xem doanh thu, sản phẩm, tồn kho, đơn hàng hoặc hồ sơ shop, hãy chuyển sang mode Dữ liệu shop rồi gửi lại nhé. Câu hỏi về chính sách/hướng dẫn thì chọn Tài liệu; yêu cầu thao tác trên shop thì chọn AI Agent 🙂.';
const OUT_OF_SCOPE_MESSAGE =
    'Mình tập trung hỗ trợ việc quản lý shop như sản phẩm, đơn hàng, doanh thu, tồn kho và chính sách seller nhé 🙂';
const SMALL_TALK_MESSAGE = 'Mình đây 🙂 Bạn cần mình hỗ trợ gì về shop?';
const NEEDS_CLARIFICATION_MESSAGE =
    'Bạn nói rõ hơn một chút để mình hiểu đúng ý nhé 🙂.';

// Chọn fallback ban đầu theo trạng thái planner và mode; không biến lỗi phân loại thành kết luận nghiệp vụ.
export function buildSellerCopilotInitialReply(
    plan: SellerQuestionPlan,
    interactionMode: 'chat' | 'shop_data' | 'knowledge' | 'agent' = 'chat',
): string {
    // Chat không có task đã xác thực nên không thể biết chắc người dùng cần nguồn nào;
    // thay vì chỉ báo lỗi, đưa chỉ dẫn theo nhóm nhu cầu để họ chọn đúng mode mà không khẳng định đã hiểu câu hỏi.
    if (
        plan.status === 'PLANNER_UNAVAILABLE' ||
        plan.status === 'PLANNER_INVALID_RESPONSE'
    ) {
        if (interactionMode === 'chat') return CHAT_PLANNER_UNAVAILABLE_MESSAGE;

        // Giữ nguyên thông báo kỹ thuật ở các mode khác vì họ đã chủ động chọn mode xử lý.
        return AI_UNAVAILABLE_MESSAGE;
    }

    // Planner có thể đề xuất câu hỏi làm rõ; nếu thiếu nội dung thì dùng fallback ổn định.
    if (plan.status === 'NEEDS_CLARIFICATION') {
        return plan.clarificationQuestion ?? NEEDS_CLARIFICATION_MESSAGE;
    }

    // Không gọi retrieval/answer cho yêu cầu nằm ngoài phạm vi đã xác định.
    if (plan.status === 'OUT_OF_SCOPE') return OUT_OF_SCOPE_MESSAGE;

    // Small talk được trả trực tiếp, không cần truy cập dữ liệu shop hay tài liệu.
    if (
        plan.tasks.length > 0 &&
        plan.tasks.every((task) => task.requestType === 'SMALL_TALK')
    ) {
        return SMALL_TALK_MESSAGE;
    }

    // READY nghiệp vụ chỉ tạm nhận giá trị này, sẽ bị thay sau retrieval/grounding hoặc khi bị chặn an toàn.
    return TEMPORARILY_UNAVAILABLE_MESSAGE;
}

// Ghi cấu trúc phân loại để chẩn đoán planner mà không lưu câu hỏi, tenant hay nội dung riêng tư vào log.
export function logSellerCopilotPlanSummary(
    logger: Logger,
    plan: SellerQuestionPlan,
): void {
    // Domain được dedupe và null bị loại; chỉ telemetry về quyết định route được giữ lại.
    const domains = [
        ...new Set(
            plan.tasks
                .map((task) => task.domain)
                .filter((domain): domain is string => domain !== null),
        ),
    ];

    logger.log(
        JSON.stringify({
            event: 'seller_question_classified',
            status: plan.status,
            contextRelation: plan.contextRelation,
            taskCount: plan.tasks.length,
            requestTypes: plan.tasks.map((task) => task.requestType),
            domains,
            failureReason: plan.failureReason,
        }),
    );
}

// Ghi kết quả abstain ở mức đủ phân biệt nguyên nhân; không log query hoặc chunk làm rò dữ liệu tài liệu.
export function logSellerCopilotAbstention(
    logger: Logger,
    requestId: string,
    reason: 'no_retrieval_results' | 'insufficient_evidence',
    evidenceCount: number,
): void {
    // Chỉ giữ request correlation ID, loại quyết định và số evidence để hỗ trợ vận hành mà không sao chép hội thoại.
    logger.warn(
        JSON.stringify({
            event: 'seller_knowledge_answer_abstained',
            requestId,
            reason,
            evidenceCount,
        }),
    );
}
