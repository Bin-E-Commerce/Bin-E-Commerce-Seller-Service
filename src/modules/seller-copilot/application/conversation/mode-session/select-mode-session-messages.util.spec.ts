// Kiểm thử chọn history cho planner/answer, đặc biệt ranh giới chuyển mode và dữ liệu legacy.
import { selectModeSessionMessages } from '@/modules/seller-copilot/application/conversation/mode-session/select-mode-session-messages.util';
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';

describe('selectModeSessionMessages', () => {
    // Tạo message tối giản nhưng giữ metadata mode/session như repository trả về.
    const createMessage = (
        id: string,
        role: SellerCopilotMessageRecord['role'],
        mode: 'chat' | 'shop_data' | 'knowledge' | 'agent',
        modeSessionId?: string,
        timelineEvent?: 'mode_changed',
    ): SellerCopilotMessageRecord => ({
        id,
        conversationId: 'conversation-1',
        role,
        content: id,
        metadata: { interactionMode: mode, modeSessionId, timelineEvent },
        createdAt: new Date(),
    });

    // Chỉ giữ cặp hội thoại sau divider, không coi system event là văn bản hỏi đáp.
    it('should stop history at the latest mode-change event', () => {
        // Arrange
        const messages = [
            createMessage('old-user', 'user', 'chat', 'old-session'),
            createMessage('old-answer', 'assistant', 'chat', 'old-session'),
            createMessage(
                'divider',
                'system',
                'knowledge',
                'new-session',
                'mode_changed',
            ),
            createMessage('new-user', 'user', 'knowledge', 'new-session'),
        ];

        // Act
        const result = selectModeSessionMessages(
            messages,
            'new-session',
            'knowledge',
        );

        // Assert
        expect(result.map(({ id }) => id)).toEqual(['new-user']);
    });

    // History trước khi có session metadata vẫn dùng được trong đoạn cuối cùng cùng mode.
    it('should preserve the latest contiguous legacy messages in the same mode', () => {
        // Arrange
        const messages = [
            createMessage('chat-user', 'user', 'chat'),
            createMessage('chat-answer', 'assistant', 'chat'),
            createMessage('shop-user', 'user', 'shop_data'),
            createMessage('shop-answer', 'assistant', 'shop_data'),
        ];

        // Act
        const result = selectModeSessionMessages(
            messages,
            'shop-user',
            'shop_data',
        );

        // Assert
        expect(result.map(({ id }) => id)).toEqual([
            'shop-user',
            'shop-answer',
        ]);
    });

    // Một session ID khác là ranh giới cứng dù mode label trùng nhau.
    it('should stop at a prior session id even when the mode is unchanged', () => {
        // Arrange
        const messages = [
            createMessage('old-user', 'user', 'chat', 'session-old'),
            createMessage('new-user', 'user', 'chat', 'session-new'),
        ];

        // Act
        const result = selectModeSessionMessages(
            messages,
            'session-new',
            'chat',
        );

        // Assert
        expect(result.map(({ id }) => id)).toEqual(['new-user']);
    });
});
