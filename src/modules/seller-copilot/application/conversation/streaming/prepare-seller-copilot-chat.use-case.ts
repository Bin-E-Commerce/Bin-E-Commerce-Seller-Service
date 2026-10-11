// Chuẩn bị tenant, conversation và mode session trước khi controller mở SSE.
// Use case này không chạy planner/AI; kết quả là scope đã xác minh cho pipeline xử lý một lượt chat.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import { buildSellerCopilotConversationTitle } from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';
import type { SellerCopilotRequest } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { PreparedSellerCopilotChat } from '@/modules/seller-copilot/application/conversation/streaming/types/prepared-seller-copilot-chat.types';

// Gói ownerId, email và permission đã được xác thực ở Gateway; shopId chỉ lấy từ access service.
interface PrepareSellerCopilotChatUserContext {
    email?: string;
    permissions?: string[];
}

// Chốt tenant trước mọi thao tác conversation, rồi kiểm tra mode session thuộc đúng conversation đó.
@Injectable()
export class PrepareSellerCopilotChatUseCase {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
        private readonly modeSessions: ConversationModeSessionService,
    ) {}

    // Xác minh shop đang hoạt động trước, resolve conversation theo cùng owner/shop rồi trả scope bất biến cho SSE.
    // Conversation ID lạ trả cùng HTTP 404 để không tiết lộ ID có thuộc người bán/tenant khác hay không.
    async execute(
        ownerUserId: string | undefined,
        request: SellerCopilotRequest,
        userContext: PrepareSellerCopilotChatUserContext = {},
    ): Promise<PreparedSellerCopilotChat> {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.getOrCreateConversation(
            shop.ownerUserId,
            shop.id,
            request.conversationId,
            request.message,
        );

        // Session mode phải được resolve sau conversation scope để client không gắn session của conversation khác.
        const modeSession = await this.modeSessions.resolveForChat({
            conversationId: conversation.id,
            interactionMode: request.interactionMode ?? 'chat',
            requestedModeSessionId: request.modeSessionId,
        });

        return {
            ownerUserId: shop.ownerUserId,
            ownerEmail: userContext.email ?? '',
            ownerPermissions: userContext.permissions ?? [],
            shopId: shop.id,
            conversationId: conversation.id,
            modeSessionId: modeSession.modeSessionId,
            shopProfile: {
                name: shop.name,
                logoUrl: shop.logoUrl,
                slug: shop.slug,
                description: shop.description,
                businessModel: shop.businessModel,
                status: shop.status,
                contactEmail: shop.contactEmail,
                contactPhone: shop.contactPhone,
            },
        };
    }

    // Tạo conversation nếu client chưa có ID; nếu có ID thì bắt buộc tìm trong đúng owner/shop đã xác minh.
    private async getOrCreateConversation(
        ownerUserId: string,
        shopId: string,
        conversationId: string | undefined,
        message: string,
    ) {
        if (!conversationId) {
            return this.repository.createConversation({
                ownerUserId,
                shopId,
                title: buildSellerCopilotConversationTitle(message),
            });
        }

        const conversation = await this.repository.findConversation(
            { ownerUserId, shopId },
            conversationId,
        );
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }
        return conversation;
    }
}
