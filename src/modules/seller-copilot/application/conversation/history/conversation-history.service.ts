import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';

// Đọc lịch sử hội thoại theo owner/shop đã xác thực; không gọi lại pipeline trả lời hay tải thêm dữ liệu live.
@Injectable()
export class ConversationHistoryService {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Trả một trang conversation trong shop hiện tại; giới hạn kích thước tránh client yêu cầu tải quá nhiều.
    async listConversations(
        ownerUserId: string | undefined,
        offset = 0,
        limit = 20,
    ) {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const safeOffset = Math.max(0, offset);
        const safeLimit = Math.min(Math.max(1, limit), 20);
        const { items, total } = await this.repository.listConversations(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            safeOffset,
            safeLimit,
        );
        const nextOffset = safeOffset + items.length;
        return {
            items,
            hasMore: nextOffset < total,
            nextOffset: nextOffset < total ? nextOffset : null,
        };
    }

    // Tìm theo tiêu đề/nội dung trong đúng tenant; query rỗng được trả ngay để tránh truy vấn vô ích.
    async searchConversations(ownerUserId: string | undefined, query: string) {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return [];
        return this.repository.searchConversations(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            normalizedQuery,
        );
    }

    // Đọc một trang tin nhắn cũ hơn cursor; xác minh quyền sở hữu trước khi đọc nội dung conversation.
    async getConversation(
        ownerUserId: string | undefined,
        conversationId: string,
        before?: string,
        limit = 20,
    ) {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.repository.findConversation(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
        );
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }

        const [beforeTimestamp, beforeId] = before ? before.split('|', 2) : [];
        const beforeDate = beforeTimestamp
            ? new Date(beforeTimestamp)
            : undefined;
        if (
            (beforeDate && Number.isNaN(beforeDate.getTime())) ||
            (before && (!beforeDate || !beforeId))
        ) {
            throw new BadRequestException('Cursor message không hợp lệ.');
        }

        const safeLimit = Math.min(Math.max(Math.floor(limit) || 20, 1), 50);
        const page = await this.repository.findMessagePageByConversation(
            conversation.id,
            beforeDate,
            beforeId,
            safeLimit,
        );
        return {
            conversation,
            messages: page.items,
            hasMoreMessages: page.hasMore,
            nextBefore: page.hasMore
                ? page.items[0]
                    ? `${page.items[0].createdAt.toISOString()}|${page.items[0].id}`
                    : null
                : null,
        };
    }
}
