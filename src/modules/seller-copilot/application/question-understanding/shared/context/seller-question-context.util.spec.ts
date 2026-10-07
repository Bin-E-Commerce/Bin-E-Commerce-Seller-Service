import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/shared/context/seller-question-context.util';

describe('buildSellerQuestionContext', () => {
    it('should keep recent turns in chronological order within configured limits', () => {
        // Arrange
        const history = [
            { role: 'user' as const, content: 'cũ' },
            { role: 'assistant' as const, content: 'trả lời cũ' },
            { role: 'user' as const, content: 'mới' },
        ];

        // Act
        const result = buildSellerQuestionContext({
            question: '  tiếp tục  ',
            history,
            historyMessageLimit: 2,
            historyCharacterLimit: 20,
        });

        // Assert
        expect(result).toEqual({
            question: 'tiếp tục',
            history: [
                { role: 'assistant', content: 'trả lời cũ' },
                { role: 'user', content: 'mới' },
            ],
        });
    });

    it('should redact common personal identifiers from current and prior messages', () => {
        // Arrange
        const history = [
            {
                role: 'assistant' as const,
                content: 'Tên shop Anh, số 0353707544',
            },
            {
                role: 'user' as const,
                content: 'Liên hệ dao@example.com hoặc 0901234567',
            },
        ];

        // Act
        const result = buildSellerQuestionContext({
            question: 'Liên hệ minh@example.com hoặc 0987654321',
            history,
        });

        // Assert
        expect(result.history).toEqual([
            {
                role: 'assistant',
                content: 'Tên shop Anh, số [số điện thoại đã ẩn]',
            },
            {
                role: 'user',
                content: 'Liên hệ [email đã ẩn] hoặc [số điện thoại đã ẩn]',
            },
        ]);
        expect(result.question).toBe(
            'Liên hệ [email đã ẩn] hoặc [số điện thoại đã ẩn]',
        );
    });

    it('should return an empty history when the configured window is zero', () => {
        // Arrange, Act
        const result = buildSellerQuestionContext({
            question: 'hỏi mới',
            history: [{ role: 'user', content: 'cũ' }],
            historyMessageLimit: 0,
        });

        // Assert
        expect(result).toEqual({ question: 'hỏi mới', history: [] });
    });
});
