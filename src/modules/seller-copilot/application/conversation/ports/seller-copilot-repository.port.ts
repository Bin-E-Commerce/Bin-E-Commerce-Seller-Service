// Port persistence của Seller Copilot; application chỉ biết dữ liệu cần dùng, không biết TypeORM hay schema database.
import type { SellerKnowledgeCitation } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type {
    SellerCopilotActionProposalRecord,
    SellerCopilotInventoryProposalPayload,
} from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type {
    SellerCopilotAnswerStatus,
    SellerCopilotAnswerStatusReason,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { SellerCopilotInsight } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
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
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata: {
        citations?: SellerKnowledgeCitation[];
        incomplete?: boolean;
        answerStatus?: SellerCopilotAnswerStatus;
        answerStatusReason?: SellerCopilotAnswerStatusReason;
        insights?: SellerCopilotInsight[];
        dataSources?: Array<{
            kind: 'shop_data' | 'live_data' | 'seller_profile';
            label: string;
        }>;
        interactionMode?: 'chat' | 'shop_data' | 'knowledge' | 'agent';
        modeSessionId?: string;
        timelineEvent?: 'mode_changed';
        actionProposal?: {
            proposalId: string;
            payload: SellerCopilotInventoryProposalPayload;
            expiresAt: string;
            status?: 'pending' | 'completed' | 'failed';
            result?: Record<string, unknown>;
        };
    } | null;
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
    // Lưu message cùng metadata cần cho history; adapter không được tự mở rộng scope ngoài conversationId đã được use case xác thực.
    saveMessage(input: {
        conversationId: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        metadata?: {
            citations?: SellerKnowledgeCitation[];
            incomplete?: boolean;
            answerStatus?: SellerCopilotAnswerStatus;
            answerStatusReason?: SellerCopilotAnswerStatusReason;
            insights?: SellerCopilotInsight[];
            actionProposal?: {
                proposalId: string;
                payload: SellerCopilotInventoryProposalPayload;
                expiresAt: string;
            };
            dataSources?: Array<{
                kind: 'shop_data' | 'live_data' | 'seller_profile';
                label: string;
            }>;
            interactionMode?: 'chat' | 'shop_data' | 'knowledge' | 'agent';
            modeSessionId?: string;
            timelineEvent?: 'mode_changed';
        } | null;
    }): Promise<void>;

    // Lấy trang conversation trong đúng owner/shop; offset/limit đã được application giới hạn và total chỉ tính trong cùng scope.
    listConversations(
        scope: SellerCopilotScope,
        offset: number,
        limit: number,
    ): Promise<{
        items: SellerCopilotConversationRecord[];
        total: number;
    }>;

    // Tìm title/message trong scope được cung cấp; kết quả chỉ gồm snippet ngắn, không tải toàn bộ history ra khỏi adapter.
    searchConversations(
        scope: SellerCopilotScope,
        query: string,
    ): Promise<SellerCopilotSearchResult[]>;

    // Tìm conversation theo cả ID và tenant; null cố ý gộp không tồn tại với ngoài scope để không cho dò ID tenant khác.
    findConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Tạo conversation gắn owner/shop canonical; implementation phải lưu cả hai khóa tenant cùng bản ghi.
    createConversation(input: {
        ownerUserId: string;
        shopId: string;
        title: string;
    }): Promise<SellerCopilotConversationRecord>;

    // Đặt giá trị pin tường minh (không toggle) trong scope; lặp cùng lệnh phải giữ trạng thái idempotent.
    setConversationPinned(
        scope: SellerCopilotScope,
        conversationId: string,
        isPinned: boolean,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Đổi title trong scope mà không làm thay đổi pin/message; null không tiết lộ conversation ngoài tenant.
    renameConversation(
        scope: SellerCopilotScope,
        conversationId: string,
        title: string,
    ): Promise<SellerCopilotConversationRecord | null>;

    // Xóa dữ liệu liên quan trong cùng transaction/scope; false biểu thị không có conversation được phép để xóa.
    deleteConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<boolean>;

    // Lấy cửa sổ mới nhất có giới hạn và trả ASC để planner/UI dùng đúng thứ tự; implementation không được bỏ scope conversation.
    findMessagesByConversation(
        conversationId: string,
        limit: number,
    ): Promise<SellerCopilotMessageRecord[]>;

    // Cursor gồm timestamp và ID để phân trang ổn định khi nhiều message trùng giờ; hasMore dựa trên row sentinel.
    findMessagePageByConversation(
        conversationId: string,
        before: Date | undefined,
        beforeId: string | undefined,
        limit: number,
    ): Promise<{
        items: SellerCopilotMessageRecord[];
        hasMore: boolean;
    }>;

    // Lưu snapshot proposal pending có TTL; tạo proposal không được gọi Product Service hoặc ghi tồn kho.
    createActionProposal(input: {
        conversationId: string;
        ownerUserId: string;
        shopId: string;
        payload: SellerCopilotInventoryProposalPayload;
        expiresAt: Date;
    }): Promise<SellerCopilotActionProposalRecord>;

    // Atomically consume pending proposal chỉ khi owner/shop khớp và chưa hết hạn; null nghĩa không được gọi downstream.
    consumeActionProposal(
        scope: SellerCopilotScope,
        proposalId: string,
    ): Promise<SellerCopilotActionProposalRecord | null>;

    // Chuyển processing sang terminal và lưu result; không cho request lặp đảo completed/failed về pending.
    completeActionProposal(
        scope: SellerCopilotScope,
        proposalId: string,
        status: 'completed' | 'failed',
        result: Record<string, unknown>,
    ): Promise<void>;

    // Kiểm tra message và conversation scope trong cùng truy vấn để không có khoảng hở giữa authorization và read.
    findMessageInScope(
        scope: SellerCopilotScope,
        messageId: string,
    ): Promise<SellerCopilotMessageRecord | null>;

    // Lưu feedback sau khi application đã xác minh message; adapter không được suy quyền từ messageId đơn lẻ.
    saveFeedback(input: {
        messageId: string;
        ownerUserId: string;
        shopId: string;
        rating: 'up' | 'down';
        reason: string | null;
    }): Promise<SellerCopilotFeedbackRecord>;
}
