// Pure title helpers của conversation; không phụ thuộc repository hoặc HTTP nên có thể dùng ở chat và rename.
export const SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH = 32;

// Chuẩn hóa title do seller nhập để persistence và sidebar không chứa khoảng trắng thừa.
export function normalizeSellerCopilotConversationTitle(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

// Tạo title ngắn từ câu hỏi đầu tiên nhưng vẫn giữ nguyên nghĩa chính của câu hỏi.
export function buildSellerCopilotConversationTitle(message: string): string {
    // Chuẩn hóa message để loại bỏ khoảng trắng thừa; nếu rỗng thì trả về title mặc định.
    const normalized = normalizeSellerCopilotConversationTitle(message);
    if (!normalized) return 'Cuộc trò chuyện mới';

    // Nếu title đã đủ ngắn thì trả về nguyên trạng; nếu quá dài thì cắt bớt và loại bỏ từ cuối cùng nếu cần.
    if (normalized.length <= SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH) {
        return normalized;
    }

    // Cắt title đến giới hạn độ dài tối đa; nếu cắt ở giữa từ thì tìm khoảng trắng cuối cùng để cắt gọn.
    const limited = normalized.slice(
        0,
        SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH,
    );

    // Tìm khoảng trắng cuối cùng trong chuỗi đã cắt; nếu không có khoảng trắng thì giữ nguyên chuỗi đã cắt.
    const lastSpace = limited.lastIndexOf(' ');

    // Nếu có khoảng trắng thì cắt đến khoảng trắng cuối cùng; nếu không có thì giữ nguyên chuỗi đã cắt.
    return (lastSpace >= 24 ? limited.slice(0, lastSpace) : limited).trimEnd();
}
