// Chuẩn hóa cửa sổ lịch sử đầu vào; không tự đọc DB và không thay thế tenant authorization của caller.
import type { SellerQuestionHistoryMessage } from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';

const DEFAULT_HISTORY_MESSAGE_LIMIT = 8; // Giới hạn số lượng tin nhắn gần nhất để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider.
const DEFAULT_HISTORY_CHARACTER_LIMIT = 4000; // Giới hạn tổng số ký tự trong lịch sử để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider; cắt bớt các tin nhắn cũ.
const MAX_QUESTION_CHARACTER_LIMIT = 2000; // Giới hạn tổng số ký tự trong câu hỏi để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider; cắt bớt các tin nhắn cũ.

// Giữ một phần hội thoại gần nhất để giải quyết follow-up nhưng chặn lịch sử dài và dữ liệu hồ sơ đã lưu.
export function buildSellerQuestionContext(input: {
    question: string;
    history?: SellerQuestionHistoryMessage[];
    historyMessageLimit?: number;
    historyCharacterLimit?: number;
}): {
    question: string;
    history: SellerQuestionHistoryMessage[];
} {
    // Chuẩn hóa câu hỏi và lịch sử; cắt bớt các tin nhắn cũ và giới hạn ký tự để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider.
    const question = redactPersonalIdentifiers(
        input.question.trim().slice(0, MAX_QUESTION_CHARACTER_LIMIT),
    );

    // Giữ một phần lịch sử gần nhất để giải quyết follow-up nhưng chặn lịch sử dài và dữ liệu hồ sơ đã lưu.
    const historyLimit = Math.max(
        0,
        Math.floor(input.historyMessageLimit ?? DEFAULT_HISTORY_MESSAGE_LIMIT),
    );

    // Giới hạn tổng số ký tự trong lịch sử để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider; cắt bớt các tin nhắn cũ.
    let remainingCharacters = Math.max(
        0,
        Math.floor(
            input.historyCharacterLimit ?? DEFAULT_HISTORY_CHARACTER_LIMIT,
        ),
    );

    // Lấy các tin nhắn gần nhất theo historyLimit, sau đó cắt bớt nội dung theo remainingCharacters; bỏ các tin nhắn rỗng sau khi cắt.
    const recentHistory = (
        historyLimit === 0 ? [] : (input.history ?? []).slice(-historyLimit)
    ).map((message) => ({
        role: message.role,
        content: redactSensitiveHistory(message),
    }));

    // Cắt bớt các tin nhắn cũ trong lịch sử để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider; giữ các tin nhắn gần nhất.
    const boundedHistory: SellerQuestionHistoryMessage[] = [];

    // Duyệt lịch sử từ gần nhất đến xa nhất để giữ các tin nhắn gần nhất và cắt bớt các tin nhắn cũ; bỏ các tin nhắn rỗng sau khi cắt.
    for (let index = recentHistory.length - 1; index >= 0; index -= 1) {
        // Nếu không còn ký tự còn lại để giữ, dừng duyệt lịch sử.
        const message = recentHistory[index];
        if (!message || remainingCharacters <= 0) break;

        // Cắt bớt nội dung tin nhắn nếu vượt quá remainingCharacters; bỏ các tin nhắn rỗng sau khi cắt.
        const content = message.content.slice(0, remainingCharacters);
        if (!content.trim()) continue;

        // Thêm tin nhắn đã cắt vào boundedHistory; duyệt lịch sử từ gần nhất đến xa nhất nên unshift để giữ thứ tự đúng.
        boundedHistory.unshift({ role: message.role, content });

        // Giảm remainingCharacters theo độ dài nội dung đã cắt; nếu còn ký tự còn lại, tiếp tục duyệt lịch sử.
        remainingCharacters -= content.length;
    }

    return { question, history: boundedHistory };
}

// Ẩn email và số điện thoại trong lịch sử trước khi gửi context sang nhà cung cấp AI.
function redactSensitiveHistory(message: SellerQuestionHistoryMessage): string {
    return redactPersonalIdentifiers(message.content);
}

// Câu hiện tại cũng có thể chứa email/số điện thoại; thay giá trị bằng nhãn nhưng giữ ngữ nghĩa yêu cầu cho planner.
function redactPersonalIdentifiers(content: string): string {
    // Thay email và số điện thoại bằng nhãn; không thay đổi ngữ nghĩa câu hỏi để planner vẫn hiểu ý.
    return content
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[email đã ẩn]')
        .replace(/(?:\+?84|0)(?:[\s.-]?\d){8,10}/gu, '[số điện thoại đã ẩn]');
}
