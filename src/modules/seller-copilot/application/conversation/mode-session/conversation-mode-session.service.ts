// Quản lý các phiên ngữ cảnh theo mode trong một conversation của seller.
// Service chỉ điều phối repository và scope đã xác thực; format timeline được lưu như system message,
// còn sessionId không thay thế quyền sở hữu conversation hoặc quyền truy cập dữ liệu shop.
import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotMessageRecord,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import type { SellerCopilotInteractionMode } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';

export interface SellerCopilotModeSession {
    modeSessionId: string;
    interactionMode: SellerCopilotInteractionMode;
}

// Tạo event mode_changed theo đúng tenant hoặc xác nhận session đang hoạt động trước khi mở stream.
// Các message lịch sử cũ chưa có sessionId được xem là một đoạn liên tiếp cùng mode; ID message user cuối
// làm khóa tương thích cho đoạn legacy đó, sau đó request mới sẽ lưu sessionId rõ ràng trên từng message.
@Injectable()
export class ConversationModeSessionService {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Ghi divider hệ thống khi seller đổi mode trong conversation đã có lịch sử.
    // Kiểm tra scope trước khi đọc message; nếu mode không đổi thì giữ nguyên ID hiện tại để thao tác lặp idempotent.
    // Event là message riêng, không được xem là hội thoại đưa vào planner hoặc câu trả lời của assistant.
    async startModeSession(
        ownerUserId: string | undefined,
        conversationId: string,
        interactionMode: SellerCopilotInteractionMode,
    ): Promise<SellerCopilotModeSession> {
        const shop = await this.access.resolveActiveShop(ownerUserId);
        const scope = { ownerUserId: shop.ownerUserId, shopId: shop.id };
        const conversation = await this.repository.findConversation(
            scope,
            conversationId,
        );
        // ID conversation chỉ được dùng nếu repository tìm thấy nó trong owner/shop đã resolve ở trên.
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }

        const recentMessages = await this.repository.findMessagesByConversation(
            conversationId,
            64,
        );
        const currentSession = this.resolveCurrentSession(recentMessages);
        // Không tạo ranh giới mode cho conversation chưa từng có message; caller phải gửi câu đầu ở mode mong muốn.
        if (!currentSession) {
            throw new ConflictException(
                'Conversation chưa có phiên để chuyển mode.',
            );
        }
        // Giữ session hiện tại khi mode không đổi để request lặp không tạo system divider và không cắt history vô cớ.
        if (currentSession.interactionMode === interactionMode) {
            return currentSession;
        }

        const modeSessionId = randomUUID();
        const label = this.getModeLabel(interactionMode);
        await this.repository.saveMessage({
            conversationId,
            role: 'system',
            content: `Bạn đã chuyển sang chế độ ${label}`,
            metadata: {
                interactionMode,
                modeSessionId,
                timelineEvent: 'mode_changed',
            },
        });

        return { modeSessionId, interactionMode };
    }

    // Xác thực mode/session từ request đã resolve conversation và tenant trước khi SSE bắt đầu.
    // Conversation mới chưa có history nên backend tự cấp session đầu tiên; conversation cũ phải tiếp tục đúng
    // phiên hiện tại hoặc đã tạo event chuyển mode, nhờ vậy client không thể lôi session cũ quay lại làm context.
    async resolveForChat(input: {
        conversationId: string;
        interactionMode: SellerCopilotInteractionMode;
        requestedModeSessionId?: string;
    }): Promise<SellerCopilotModeSession> {
        const messages = await this.repository.findMessagesByConversation(
            input.conversationId,
            64,
        );
        const currentSession = this.resolveCurrentSession(messages);

        if (!currentSession) {
            // Conversation mới chưa có session có thể nhận session backend cấp; session ID do client tự đoán thì bị từ chối.
            if (input.requestedModeSessionId) {
                throw new ConflictException('Phiên hội thoại không hợp lệ.');
            }
            return {
                modeSessionId: randomUUID(),
                interactionMode: input.interactionMode,
            };
        }

        if (currentSession.interactionMode !== input.interactionMode) {
            throw new ConflictException(
                'Mode đã thay đổi. Hãy bắt đầu phiên mode mới trước khi gửi câu hỏi.',
            );
        }
        if (
            input.requestedModeSessionId &&
            input.requestedModeSessionId !== currentSession.modeSessionId
        ) {
            // Client giữ session cũ sau khi đổi mode phải reload; không cho dùng lại context của phiên đã đóng.
            throw new ConflictException(
                'Phiên hội thoại đã cũ. Hãy tải lại conversation trước khi gửi tiếp.',
            );
        }

        return currentSession;
    }

    // Lấy mode-session mới nhất; message thường mang sessionId, dữ liệu cũ dùng ID user trong cùng đoạn mode.
    // System event và metadata mode khác là ranh giới cứng để không khôi phục nhầm session đã đóng.
    private resolveCurrentSession(
        messages: SellerCopilotMessageRecord[],
    ): SellerCopilotModeSession | null {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message) continue;

            // Divider mới nhất là authoritative; nếu metadata của nó hỏng thì dừng thay vì lùi về session cũ.
            if (message.metadata?.timelineEvent === 'mode_changed') {
                if (
                    message.metadata.modeSessionId &&
                    message.metadata.interactionMode
                ) {
                    return {
                        modeSessionId: message.metadata.modeSessionId,
                        interactionMode: message.metadata.interactionMode,
                    };
                }
                return null;
            }

            // System message khác không phải input hội thoại, nhưng không kết thúc việc tìm session gần nhất.
            if (message.role === 'system') continue;
            // Legacy message không có mode không đủ bằng chứng để mở lại một session; tiếp tục tìm message có metadata.
            if (!message.metadata?.interactionMode) continue;

            return {
                modeSessionId:
                    message.metadata.modeSessionId ??
                    this.findLegacyUserMessageId(
                        messages,
                        index,
                        message.metadata.interactionMode,
                    ),
                interactionMode: message.metadata.interactionMode,
            };
        }

        return null;
    }

    // Chọn message user gần nhất trong cùng đoạn legacy để có ID ổn định giữa lần mở lại và request kế tiếp.
    private findLegacyUserMessageId(
        messages: SellerCopilotMessageRecord[],
        beforeIndex: number,
        interactionMode: SellerCopilotInteractionMode,
    ): string {
        for (let index = beforeIndex; index >= 0; index -= 1) {
            const message = messages[index];
            if (!message) continue;
            if (message.metadata?.timelineEvent === 'mode_changed') break;
            // Không mượn ID user từ đoạn mode khác, vì session fallback phải nằm trong cùng phân đoạn legacy.
            if (
                message.metadata?.interactionMode &&
                message.metadata.interactionMode !== interactionMode
            ) {
                break;
            }
            if (message.role === 'user') return message.id;
        }
        return messages[beforeIndex]?.id ?? randomUUID();
    }

    // Nhãn lưu vào system event là copy UI ổn định, không lấy từ model hoặc nội dung người dùng.
    private getModeLabel(mode: SellerCopilotInteractionMode): string {
        return {
            chat: 'Trò chuyện',
            shop_data: 'Dữ liệu shop',
            knowledge: 'Tài liệu',
            agent: 'AI Agent',
        }[mode];
    }
}
