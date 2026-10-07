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
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import {
    normalizeSellerCopilotConversationTitle,
    SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH,
} from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';

// Use case cho thao tác quản lý hội thoại; mọi lệnh đều lấy owner từ identity và resolve shop hoạt động trước repository.
// Service không tạo query SQL; repository áp cùng owner/shop scope khi đọc hoặc ghi từng conversation/message.
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
        // Resolve identity trước để mọi thay đổi đều dùng owner/shop từ quyền đã xác minh, không dùng scope do caller tự truyền.
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.repository.setConversationPinned(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
            isPinned,
        );
        // Repository trả null khi ID không thuộc scope hoặc không tồn tại; dùng cùng một lỗi để không tiết lộ tenant khác.
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
        // Chuẩn hóa trước khi kiểm tra để khoảng trắng đầu/cuối không làm title hợp lệ bị từ chối hoặc lưu sai.
        const normalizedTitle = normalizeSellerCopilotConversationTitle(title);
        // Từ chối title rỗng trước khi resolve shop/repository để request vô hiệu không tạo I/O không cần thiết.
        if (!normalizedTitle) {
            throw new BadRequestException('Tên đoạn chat không được để trống.');
        }
        // Kiểm tra giới hạn trên chuỗi đã chuẩn hóa, đúng với dữ liệu sẽ lưu và giới hạn DB/API.
        if (
            normalizedTitle.length >
            SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH
        ) {
            throw new BadRequestException(
                `Tên đoạn chat không được dài quá ${SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH} ký tự.`,
            );
        }
        // Chỉ sau validation mới xác minh tenant và gọi repository; dữ liệu không hợp lệ không chạm persistence.
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const conversation = await this.repository.renameConversation(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
            normalizedTitle,
        );
        // null bao gồm cả ID không tồn tại và ID ngoài scope nhằm tránh dò conversation của shop khác.
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
        // Resolve scope trước thao tác xóa; adapter đảm bảo message/feedback liên quan được dọn cùng transaction.
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const deleted = await this.repository.deleteConversation(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            conversationId,
        );
        // Không có bản ghi bị xóa nghĩa là ID không thuộc scope hiện tại hoặc đã mất; không coi đó là xóa thành công.
        if (!deleted) {
            throw new NotFoundException('Conversation không tồn tại.');
        }
    }

    // Chỉ ghi feedback cho message đã thuộc conversation của shop hiện tại.
    async addFeedback(
        ownerUserId: string | undefined,
        input: { messageId: string; rating: 'up' | 'down'; reason?: string },
    ) {
        // Lấy scope từ identity tin cậy trước khi tra message, để messageId đơn lẻ không thể truy cập chéo shop.
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const message = await this.repository.findMessageInScope(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            input.messageId,
        );
        // Chỉ cho feedback message thực sự nằm trong conversation thuộc scope; không tạo feedback mồ côi.
        if (!message) {
            throw new NotFoundException('Message không tồn tại.');
        }
        // Chuẩn hóa reason rỗng thành null để persistence không phân biệt chuỗi chỉ chứa khoảng trắng với không có lý do.
        return this.repository.saveFeedback({
            messageId: input.messageId,
            ownerUserId: shop.ownerUserId,
            shopId: shop.id,
            rating: input.rating,
            reason: input.reason?.trim() || null,
        });
    }
}
