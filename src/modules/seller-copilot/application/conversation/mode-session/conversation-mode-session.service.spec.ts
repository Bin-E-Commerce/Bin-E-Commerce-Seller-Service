// Kiểm thử quyền sở hữu, idempotency và ranh giới mode-session bằng repository/access giả.
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import type { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';

describe('ConversationModeSessionService', () => {
    let target: ConversationModeSessionService;
    let mockAccess: { resolveActiveShop: jest.Mock };
    let mockRepository: {
        findConversation: jest.Mock;
        findMessagesByConversation: jest.Mock;
        saveMessage: jest.Mock;
    };

    // Mỗi ca nhận dependency giả tươi để không rò dữ liệu conversation giữa các test.
    beforeEach(() => {
        mockAccess = {
            resolveActiveShop: jest.fn().mockResolvedValue({
                ownerUserId: 'owner-1',
                id: 'shop-1',
            }),
        };
        mockRepository = {
            findConversation: jest.fn().mockResolvedValue({
                id: 'conversation-1',
            }),
            findMessagesByConversation: jest.fn().mockResolvedValue([
                {
                    id: 'message-1',
                    conversationId: 'conversation-1',
                    role: 'assistant',
                    content: 'Câu trả lời',
                    metadata: {
                        interactionMode: 'chat',
                        modeSessionId: 'session-chat',
                    },
                    createdAt: new Date('2026-01-01T00:00:00.000Z'),
                },
            ]),
            saveMessage: jest.fn().mockResolvedValue(undefined),
        };
        target = new ConversationModeSessionService(
            mockAccess as unknown as SellerCopilotAccessService,
            mockRepository as unknown as SellerCopilotRepositoryPort,
        );
    });

    // Chỉ một lần đổi mode được lưu thành system event trong đúng conversation đã xác minh.
    it('should persist a mode divider and return its new session id', async () => {
        // Arrange
        const inputMode = 'knowledge' as const;

        // Act
        const result = await target.startModeSession(
            'owner-1',
            'conversation-1',
            inputMode,
        );

        // Assert
        expect(result).toMatchObject({ interactionMode: inputMode });
        expect(result.modeSessionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
        );
        expect(mockRepository.saveMessage).toHaveBeenCalledWith({
            conversationId: 'conversation-1',
            role: 'system',
            content: 'Bạn đã chuyển sang chế độ Tài liệu',
            metadata: {
                interactionMode: 'knowledge',
                modeSessionId: result.modeSessionId,
                timelineEvent: 'mode_changed',
            },
        });
    });

    // Retry chọn lại mode hiện tại trả cùng session và không tạo divider trùng.
    it('should reuse the current session when the selected mode has not changed', async () => {
        // Arrange
        mockRepository.findMessagesByConversation.mockResolvedValue([
            {
                id: 'message-1',
                conversationId: 'conversation-1',
                role: 'assistant',
                content: 'Câu trả lời',
                metadata: {
                    interactionMode: 'chat',
                    modeSessionId: 'session-chat',
                },
                createdAt: new Date(),
            },
        ]);

        // Act
        const result = await target.startModeSession(
            'owner-1',
            'conversation-1',
            'chat',
        );

        // Assert
        expect(result).toEqual({
            modeSessionId: 'session-chat',
            interactionMode: 'chat',
        });
        expect(mockRepository.saveMessage).not.toHaveBeenCalled();
    });

    // Request cũ không được tiếp tục sau khi phiên hiện tại đã đổi mode.
    it('should reject a request from a stale mode session', async () => {
        // Arrange

        // Act & Assert
        await expect(
            target.resolveForChat({
                conversationId: 'conversation-1',
                interactionMode: 'knowledge',
                requestedModeSessionId: 'session-chat',
            }),
        ).rejects.toThrow(ConflictException);
    });

    // Không xác nhận hoặc ghi divider nếu conversation không thuộc owner/shop hiện tại.
    it('should reject mode changes for a conversation outside the active shop', async () => {
        // Arrange
        mockRepository.findConversation.mockResolvedValue(null);

        // Act & Assert
        await expect(
            target.startModeSession('owner-1', 'conversation-1', 'agent'),
        ).rejects.toThrow(NotFoundException);
        expect(mockRepository.saveMessage).not.toHaveBeenCalled();
    });
});
