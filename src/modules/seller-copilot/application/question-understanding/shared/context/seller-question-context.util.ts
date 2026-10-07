// Chuẩn hóa cửa sổ lịch sử đầu vào; không tự đọc DB và không thay thế tenant authorization của caller.
import type { SellerQuestionHistoryMessage } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

const DEFAULT_HISTORY_MESSAGE_LIMIT = 8; // Giới hạn cửa sổ ở 8 message gần nhất để giảm token và không gửi cả conversation dài sang planner.
const DEFAULT_HISTORY_CHARACTER_LIMIT = 4000; // Khi history vượt ngân sách, ưu tiên context mới vì đại từ thường trỏ về ngữ cảnh gần.
const MAX_QUESTION_CHARACTER_LIMIT = 2000; // Chặn prompt quá dài trước provider; phần vượt ngưỡng bị cắt ở cuối câu hỏi.

// Chuẩn hóa câu hỏi/history cho planner: che email/số điện thoại, giới hạn kích thước và giữ thứ tự hội thoại.
// Hàm không xác thực tenant và chỉ che hai dạng PII phổ biến; caller phải cấp history đúng conversation, không xem đây là bộ lọc PII đầy đủ.
export function buildSellerQuestionContext(input: {
    question: string;
    history?: SellerQuestionHistoryMessage[];
    historyMessageLimit?: number;
    historyCharacterLimit?: number;
}): {
    question: string;
    history: SellerQuestionHistoryMessage[];
} {
    // Cắt câu hỏi trước khi gửi và che email/số điện thoại; câu quá dài có thể mất phần cuối nên giới hạn này cần được đánh giá bằng dữ liệu thật.
    const question = redactPersonalIdentifiers(
        input.question.trim().slice(0, MAX_QUESTION_CHARACTER_LIMIT),
    );

    // Giá trị âm được ép về 0 để caller có thể chủ động tắt history mà không tạo slice bất thường.
    const historyLimit = Math.max(
        0,
        Math.floor(input.historyMessageLimit ?? DEFAULT_HISTORY_MESSAGE_LIMIT),
    );

    // Trần ký tự độc lập với số message: một câu trả lời assistant dài không được làm prompt phình vô hạn.
    let remainingCharacters = Math.max(
        0,
        Math.floor(
            input.historyCharacterLimit ?? DEFAULT_HISTORY_CHARACTER_LIMIT,
        ),
    );

    // Redact trước khi tính ngân sách để giới hạn áp dụng trên đúng chuỗi cuối cùng gửi cho planner.
    const recentHistory = (
        historyLimit === 0 ? [] : (input.history ?? []).slice(-historyLimit)
    ).map((message) => ({
        role: message.role,
        content: redactSensitiveHistory(message),
    }));

    // Duyệt ngược để dành ngân sách cho message gần nhất; unshift ở dưới sẽ khôi phục thứ tự cũ → mới.
    const boundedHistory: SellerQuestionHistoryMessage[] = [];

    // Duyệt lịch sử từ gần nhất đến xa nhất để giữ các tin nhắn gần nhất và cắt bớt các tin nhắn cũ; bỏ các tin nhắn rỗng sau khi cắt.
    for (let index = recentHistory.length - 1; index >= 0; index -= 1) {
        // Hết ngân sách thì dừng; message rỗng hoặc không còn sau redact không giúp planner giải quyết tham chiếu.
        const message = recentHistory[index];
        if (!message || remainingCharacters <= 0) break;

        // Giữ prefix của message cuối cùng vừa ngân sách; phần logic này có thể cắt giữa câu nếu message đơn lẻ quá dài.
        const content = message.content.slice(0, remainingCharacters);
        if (!content.trim()) continue;

        // Vòng lặp đi từ mới về cũ nên unshift để output vẫn ở đúng thứ tự hội thoại.
        boundedHistory.unshift({ role: message.role, content });

        // Message cũ hơn chỉ được dùng phần ký tự còn dư sau khi giữ message mới.
        remainingCharacters -= content.length;
    }

    return { question, history: boundedHistory };
}

// Redact email/số điện thoại ở một message; không thực hiện scrub tên, địa chỉ hay mã đơn hàng.
function redactSensitiveHistory(message: SellerQuestionHistoryMessage): string {
    return redactPersonalIdentifiers(message.content);
}

// Ẩn email/số điện thoại nhưng giữ phần chữ xung quanh để planner còn hiểu intent và tham chiếu.
function redactPersonalIdentifiers(content: string): string {
    // Thay email và số điện thoại bằng nhãn; không thay đổi ngữ nghĩa câu hỏi để planner vẫn hiểu ý.
    return content
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[email đã ẩn]')
        .replace(/(?:\+?84|0)(?:[\s.-]?\d){8,10}/gu, '[số điện thoại đã ẩn]');
}
