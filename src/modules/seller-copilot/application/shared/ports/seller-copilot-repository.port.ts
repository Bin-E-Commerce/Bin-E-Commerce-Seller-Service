// Port persistence của Seller Copilot; application chỉ biết dữ liệu cần dùng, không biết TypeORM hay schema database.
export const SELLER_COPILOT_REPOSITORY = Symbol('SELLER_COPILOT_REPOSITORY');

// Bản ghi conversation, message và feedback được định nghĩa ở đây để application dùng mà không cần biết database.
export type SellerCopilotConversationRecord = {
    id: string;
    ownerUserId: string;
    shopId: string;
    title: string;
    isPinned: boolean;
    pinnedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

// Bản ghi message và feedback được định nghĩa ở đây để application dùng mà không cần biết database.
export type SellerCopilotMessageRecord = {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: Date;
};

// Bản ghi feedback được định nghĩa ở đây để application dùng mà không cần biết database.
export type SellerCopilotFeedbackRecord = {
    id: string;
    messageId: string;
    ownerUserId: string;
    shopId: string;
    rating: 'up' | 'down';
    reason: string | null;
    createdAt: Date;
};

// Port repository của Seller Copilot; application chỉ biết dữ liệu cần dùng, không biết TypeORM hay schema database.
export type SellerCopilotScope = {
    ownerUserId: string;
    shopId: string;
};

// Kết quả tìm kiếm conversation theo nội dung; snippet là đoạn trích ngắn gọn để hiển thị, matchedIn cho biết khớp ở đâu.
export type SellerCopilotSearchResult = {
    conversationId: string;
    title: string;
    snippet: string;
    matchedIn: 'title' | 'user' | 'assistant';
    updatedAt: string;
};

// Port repository của Seller Copilot; application chỉ biết dữ liệu cần dùng, không biết TypeORM hay schema database.
export interface SellerCopilotRepositoryPort {
    // Lưu nội dung một tin nhắn user/assistant vào conversation đã xác định.
    saveMessage(input: {
        conversationId: string;
        role: 'user' | 'assistant';
        content: string;
    }): Promise<void>;

    // Lấy danh sách conversation thuộc owner/shop, phân trang bằng offset/limit và trả tổng số kết quả.
    listConversations(
        scope: SellerCopilotScope,
        offset: number,
        limit: number,
    ): Promise<{
        items: SellerCopilotConversationRecord[];
        total: number;
    }>;

    // Tìm conversation theo nội dung trong phạm vi shop hiện tại và trả các đoạn khớp ngắn gọn.
    searchConversations(
        scope: SellerCopilotScope,
        query: string,
    ): Promise<SellerCopilotSearchResult[]>;

    // Tìm một conversation trong scope được phép; trả null nếu không tồn tại hoặc không thuộc scope.
    findConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Tạo conversation mới gắn với owner và shop, rồi trả bản ghi vừa tạo.
    createConversation(input: {
        ownerUserId: string;
        shopId: string;
        title: string;
    }): Promise<SellerCopilotConversationRecord>;

    // Đổi trạng thái ghim của conversation trong scope; trả null nếu không tìm thấy bản ghi hợp lệ.
    setConversationPinned(
        scope: SellerCopilotScope,
        conversationId: string,
        isPinned: boolean,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Đổi tiêu đề conversation trong scope; trả null nếu conversation không tồn tại hoặc không được phép sửa.
    renameConversation(
        scope: SellerCopilotScope,
        conversationId: string,
        title: string,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Xóa conversation trong scope và trả true khi có bản ghi được xóa.
    deleteConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<boolean>;

    // Lấy tối đa limit tin nhắn gần nhất; kết quả theo thứ tự cũ đến mới để dựng đúng mạch hội thoại.
    findMessagesByConversation(
        conversationId: string,
        limit: number,
    ): Promise<SellerCopilotMessageRecord[]>;

    // Lấy một trang message cũ hơn con trỏ before/beforeId và báo còn trang trước hay không.
    findMessagePageByConversation(
        conversationId: string,
        before: Date | undefined,
        beforeId: string | undefined,
        limit: number,
    ): Promise<{
        items: SellerCopilotMessageRecord[];
        hasMore: boolean;
    }>;

    // Tìm message theo ID trong scope conversation được phép; trả null nếu không khớp quyền hoặc không tồn tại.
    findMessageInScope(
        scope: SellerCopilotScope,
        messageId: string,
    ): Promise<SellerCopilotMessageRecord | null>;

    // Lưu đánh giá của owner cho message thuộc shop, gồm mức đánh giá và lý do tùy chọn.
    saveFeedback(input: {
        messageId: string;
        ownerUserId: string;
        shopId: string;
        rating: 'up' | 'down';
        reason: string | null;
    }): Promise<SellerCopilotFeedbackRecord>;
}
