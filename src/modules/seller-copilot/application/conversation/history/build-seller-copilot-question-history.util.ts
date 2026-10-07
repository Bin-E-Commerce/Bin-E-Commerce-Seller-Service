// Dựng history an toàn cho planner từ đúng phiên mode; không cấp lịch sử quyền truy xuất nguồn dữ liệu.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { selectModeSessionMessages } from '@/modules/seller-copilot/application/conversation/mode-session/select-mode-session-messages.util';
import type { SellerCopilotInteractionMode } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { SellerQuestionHistoryMessage } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

// Các câu trả lời này không mô tả chủ đề người bán muốn hỏi tiếp.
// Metadata mới là tín hiệu chính; nội dung cố định chỉ giữ tương thích với hội thoại cũ.
const NON_CONTEXTUAL_ASSISTANT_REPLIES = new Set([
    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
    'Hiện tại trợ lý AI chưa sẵn sàng. Bạn quay lại sau giúp mình nhé 🙂',
    'Mình tập trung hỗ trợ việc quản lý shop như sản phẩm, đơn hàng, doanh thu, tồn kho và chính sách seller nhé 🙂',
    'Hiện tại mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này. Bạn có thể liên hệ quản trị viên của shop để được hỗ trợ thêm nhé 🙂.',
    'Mình chưa thể xác minh câu trả lời từ tài liệu lúc này. Bạn thử gửi lại câu hỏi sau nhé.',
]);

// Chỉ giữ lượt có ngữ cảnh để hiểu follow-up; system event, lỗi và lượt bị hủy không nên làm planner lệch chủ đề.
export function buildSellerCopilotQuestionHistory(
    recentMessages: SellerCopilotMessageRecord[],
    modeSessionId: string,
    interactionMode: SellerCopilotInteractionMode,
): SellerQuestionHistoryMessage[] {
    // Chặn lịch sử ở ranh giới phiên mode trước khi lọc nội dung, tránh câu ở mode khác làm đổi cách diễn giải.
    const sessionMessages = selectModeSessionMessages(
        recentMessages,
        modeSessionId,
        interactionMode,
    );
    const history: SellerQuestionHistoryMessage[] = [];

    for (let index = 0; index < sessionMessages.length; index += 1) {
        const message = sessionMessages[index];

        // System chỉ là sự kiện/hướng dẫn nội bộ, không thuộc contract role của planner.
        if (!message || message.role === 'system') continue;

        if (message.role === 'user') {
            // Bỏ câu hỏi gắn với lượt chỉ có phản hồi lỗi; giữ lại nếu sau lỗi đã có assistant reply hữu ích.
            if (hasOnlyNonContextualReplies(sessionMessages, index)) continue;
            history.push({ role: 'user', content: message.content });
            continue;
        }

        // Assistant reply có nội dung chủ đề mới giúp xử lý đại từ như “cả hai”; từ chối/lỗi không được nối vào lượt sau.
        if (!isNonContextualAssistantReply(message)) {
            history.push({ role: 'assistant', content: message.content });
        }
    }

    return history;
}

// Metadata là nguồn chuẩn cho phản hồi mới; câu cố định chỉ dùng làm fallback cho message cũ chưa lưu trạng thái.
function isNonContextualAssistantReply(
    message: SellerCopilotMessageRecord,
): boolean {
    return (
        message.role === 'assistant' &&
        (message.metadata?.answerStatus === 'unsupported' ||
            message.metadata?.answerStatus === 'provider_error' ||
            message.metadata?.incomplete === true ||
            NON_CONTEXTUAL_ASSISTANT_REPLIES.has(message.content))
    );
}

// Duyệt đúng một lượt user: dừng khi gặp user/system kế tiếp và chỉ bỏ câu hỏi nếu có assistant reply mà tất cả đều không hữu ích.
function hasOnlyNonContextualReplies(
    messages: SellerCopilotMessageRecord[],
    userMessageIndex: number,
): boolean {
    let foundAssistantReply = false;

    for (
        let index = userMessageIndex + 1;
        index < messages.length;
        index += 1
    ) {
        const message = messages[index];

        // Không vượt qua ranh giới lượt; nếu không, câu hỏi user sau có thể bị quy nhầm cho phản hồi trước.
        if (
            !message ||
            message.role === 'user' ||
            message.role === 'system'
        ) {
            break;
        }

        foundAssistantReply = true;
        // Một câu trả lời hữu ích trong cùng lượt đủ để giữ câu hỏi làm history.
        if (!isNonContextualAssistantReply(message)) return false;
    }

    return foundAssistantReply;
}
