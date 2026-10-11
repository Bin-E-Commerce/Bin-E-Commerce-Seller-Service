// Nối câu trả lời làm rõ của luồng xả hàng với tiêu chí trước đó trong đúng phiên Agent.
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';

const CLEARANCE_COMMAND = /^@(?:xả-hàng|xa-hang)(?![\p{L}\p{N}_-])/iu;
const PERIOD_ONLY_REPLY = /^\s*(?:@(?:xả-hàng|xa-hang)\s*)?(7|30|90)(?:\s*ngày)?(?:\s*(?:nha|nhé|đi|ạ))?[.!?\s]*$/iu;

// Chỉ dùng tiêu chí cũ khi phản hồi assistant trước đó đang hỏi đúng phần còn thiếu của luồng xả hàng.
// Tin nhắn được lọc theo mode/session trước khi tìm, nên không thể mượn ngữ cảnh từ chat hoặc phiên Agent khác.
export function resolveAgentClearanceFollowUp(input: {
    recentMessages: SellerCopilotMessageRecord[];
    modeSessionId: string;
    question: string;
}): { message: string; contextMessages: string[] } {
    const sessionMessages = input.recentMessages.filter(
        (message) =>
            message.role !== 'system' &&
            message.metadata?.interactionMode === 'agent' &&
            message.metadata.modeSessionId === input.modeSessionId,
    );
    const previousAssistant = [...sessionMessages]
        .reverse()
        .find((message) => message.role === 'assistant');
    const asksForPeriod = Boolean(
        previousAssistant?.content.includes(
            'Kỳ thống kê chỉ hỗ trợ 7, 30 hoặc 90 ngày',
        ),
    );
    const asksForCriteria = Boolean(
        previousAssistant?.content.includes(
            'Để lọc và đề xuất an toàn',
        ),
    );
    const isExplicitClearanceCommand = CLEARANCE_COMMAND.test(
        input.question.trim(),
    );
    const periodReply = input.question.match(PERIOD_ONLY_REPLY);

    // Một câu trả lời chỉ gồm số ngày có ý nghĩa khi assistant vừa hỏi kỳ; không biến số bất kỳ thành lệnh xả hàng.
    if (!isExplicitClearanceCommand && !(asksForPeriod && periodReply)) {
        return { message: input.question, contextMessages: [] };
    }
    if (!asksForPeriod && !asksForCriteria) {
        return { message: input.question, contextMessages: [] };
    }

    const previousClearanceRequest = [...sessionMessages]
        .reverse()
        .find(
            (message) =>
                message.role === 'user' &&
                CLEARANCE_COMMAND.test(message.content.trim()),
        );
    if (!previousClearanceRequest) {
        return { message: input.question, contextMessages: [] };
    }

    // Chuẩn hóa câu trả lời ngắn thành kỳ thống kê; các trường khác vẫn phải có trong câu gốc hoặc được hỏi bổ sung.
    const message = periodReply && !isExplicitClearanceCommand
        ? `trong ${periodReply[1]} ngày`
        : input.question;

    return {
        message,
        contextMessages: [previousClearanceRequest.content],
    };
}
