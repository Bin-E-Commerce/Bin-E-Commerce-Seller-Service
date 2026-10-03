// Conversation command use case: pin, rename, delete và feedback trong owner/shop scope.
// Service giữ validation nghiệp vụ ở application, còn SQL/transaction vẫn nằm trong repository adapter.
import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/shared/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import {
    normalizeSellerCopilotConversationTitle,
    SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH,
} from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';

@Injectable()
export class ConversationPersistenceService {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Ghim hoặc bỏ ghim conversation đã được repository kiểm tra cùng owner/shop scope.
    async setConversationPinned(
        ownerUserId: string | undefined,
        conversationId: string,
        isPinned: boolean,
    ) {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.repository.setConversationPinned(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
            isPinned,
        );
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }
        return conversation;
    }

    // Chuẩn hóa title và chặn title rỗng/quá dài trước khi ghi persistence.
    async renameConversation(
        ownerUserId: string | undefined,
        conversationId: string,
        title: string,
    ) {
        const normalizedTitle = normalizeSellerCopilotConversationTitle(title);
        if (!normalizedTitle) {
            throw new BadRequestException('Tên đoạn chat không được để trống.');
        }
        if (
            normalizedTitle.length >
            SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH
        ) {
            throw new BadRequestException(
                `Tên đoạn chat không được dài quá ${SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH} ký tự.`,
            );
        }
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.repository.renameConversation(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
            normalizedTitle,
        );
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }
        return conversation;
    }

    // Xóa conversation trong đúng tenant; repository chịu trách nhiệm dọn message/feedback atomically.
    async deleteConversation(
        ownerUserId: string | undefined,
        conversationId: string,
    ): Promise<void> {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const deleted = await this.repository.deleteConversation(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
        );
        if (!deleted) {
            throw new NotFoundException('Conversation không tồn tại.');
        }
    }

    // Chỉ ghi feedback cho message đã thuộc conversation của shop hiện tại.
    async addFeedback(
        ownerUserId: string | undefined,
        input: { messageId: string; rating: 'up' | 'down'; reason?: string },
    ) {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const message = await this.repository.findMessageInScope(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            input.messageId,
        );
        if (!message) {
            throw new NotFoundException('Message không tồn tại.');
        }
        return this.repository.saveFeedback({
            messageId: input.messageId,
            ownerUserId: shop.ownerUserId,
            shopId: shop.id,
            rating: input.rating,
            reason: input.reason?.trim() || null,
        });
    }
}
