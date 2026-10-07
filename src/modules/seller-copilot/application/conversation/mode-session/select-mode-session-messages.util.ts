// Lọc history trước khi planner/answer nhận conversation; system events không phải ngôn ngữ hội thoại.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotInteractionMode } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';

// Chọn đoạn message liên tiếp thuộc mode-session hiện tại, giữ nguyên thứ tự user → assistant.
// Metadata sessionId là ranh giới chính; message legacy thiếu ID được giữ trong cùng mode cho tới khi gặp
// mode khác hoặc system event, nhờ đó lịch sử cũ không bị lộ qua mode mới và vẫn hỗ trợ follow-up cùng mode.
export function selectModeSessionMessages(
    messages: SellerCopilotMessageRecord[],
    modeSessionId: string | undefined,
    interactionMode: SellerCopilotInteractionMode,
): SellerCopilotMessageRecord[] {
    const selected: SellerCopilotMessageRecord[] = [];

    // Repository trả message theo chiều cũ → mới; quét ngược để gặp ranh giới gần nhất trước rồi unshift giữ thứ tự gốc.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        // Bỏ slot rỗng phòng contract adapter bị lệch; không làm thay đổi quyết định session của các message còn lại.
        if (!message) continue;

        // Event đổi mode là hard boundary; không đưa event hoặc nội dung trước đó vào prompt.
        if (message.role === 'system') break;

        // Chặn cả mode cũ và session cũ; trường hợp metadata vắng chỉ chấp nhận legacy cùng mode.
        if (
            message.metadata?.interactionMode !== interactionMode ||
            (message.metadata.modeSessionId &&
                message.metadata.modeSessionId !== modeSessionId)
        ) {
            break;
        }

        selected.unshift(message);
    }

    return selected;
}
