// Kiểm thử handoff giữa các mode từ loại nguồn trong registry; không gọi retrieval hoặc dashboard thật.
import { resolveKnowledgeModeHandoff as target } from '@/modules/seller-copilot/application/answer/modes/chat/resolve-chat-mode-handoff.util';
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

describe('resolveKnowledgeModeHandoff', () => {
    // Dữ liệu chuẩn giống contract planner đã được validate trước khi vào bước routing.
    const task = (
        domain: string,
        requestType: SellerQuestionTask['requestType'] = 'READ_QUERY',
    ): SellerQuestionTask => ({
        requestType,
        domain,
        resolvedQuestion: 'Đơn nào đã giao cho khách?',
    });

    // Live/profile phải chuyển mode, còn nội dung knowledge không bị chuyển vòng sang chính mode đang dùng.
    it('redirects live and profile questions to Shop Data but keeps knowledge questions in place', () => {
        // Arrange
        const domainKinds = new Map([
            ['seller-orders', 'live-data'] as const,
            ['seller-profile', 'profile'] as const,
            ['seller-policy', 'knowledge'] as const,
        ]);

        // Act / Assert
        expect(target([task('seller-orders')], domainKinds)).toContain(
            'cần chế độ Dữ liệu shop',
        );
        expect(target([task('seller-profile')], domainKinds)).toContain(
            'cần chế độ Dữ liệu shop',
        );
        expect(target([task('seller-policy')], domainKinds)).toBeNull();
    });

    // Capability và small talk không cần đọc dữ liệu live nên không kích hoạt đổi mode.
    it('does not redirect tasks that do not read shop data', () => {
        // Arrange
        const domainKinds = new Map([['seller-orders', 'live-data'] as const]);

        // Act / Assert
        expect(
            target([task('seller-orders', 'CAPABILITY_QUERY')], domainKinds),
        ).toBeNull();
    });
});
