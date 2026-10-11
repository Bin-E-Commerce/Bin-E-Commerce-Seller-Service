import { resolveAgentClearanceFollowUp } from '@/modules/seller-copilot/application/answer/modes/agent/follow-ups/resolve-agent-clearance-follow-up.util';
import type { SellerCopilotMessageRecord } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';

describe('resolveAgentClearanceFollowUp', () => {
    const makeMessage = (
        role: 'user' | 'assistant',
        content: string,
        modeSessionId = 'session-1',
    ): SellerCopilotMessageRecord => ({
        id: `${role}-${content}`,
        conversationId: 'conversation-1',
        role,
        content,
        metadata: { interactionMode: 'agent', modeSessionId },
        createdAt: new Date('2026-10-11T10:00:00.000Z'),
    });

    // Chỉ câu trả lời số ngày sau câu hỏi kỳ thống kê mới được nối vào lệnh xả hàng trước đó.
    it('reuses criteria when the seller answers a supported period clarification', () => {
        const result = resolveAgentClearanceFollowUp({
            recentMessages: [
                makeMessage(
                    'user',
                    '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
                ),
                makeMessage(
                    'assistant',
                    'Kỳ thống kê chỉ hỗ trợ 7, 30 hoặc 90 ngày. Bạn chọn một kỳ này giúp mình nhé.',
                ),
            ],
            modeSessionId: 'session-1',
            question: '90 nha',
        });

        expect(result).toEqual({
            message: 'trong 90 ngày',
            contextMessages: [
                '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
            ],
        });
    });

    // Không lấy tiêu chí từ phiên khác; explicit command vẫn được xử lý riêng mà không mượn nhầm lịch sử.
    it('does not reuse criteria from another Agent session', () => {
        const result = resolveAgentClearanceFollowUp({
            recentMessages: [
                makeMessage(
                    'user',
                    '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
                    'session-other',
                ),
                makeMessage(
                    'assistant',
                    'Kỳ thống kê chỉ hỗ trợ 7, 30 hoặc 90 ngày. Bạn chọn một kỳ này giúp mình nhé.',
                    'session-other',
                ),
            ],
            modeSessionId: 'session-1',
            question: '90 nha',
        });

        expect(result).toEqual({ message: '90 nha', contextMessages: [] });
    });

    // Khi seller lặp lại @xả-hàng để trả lời, parser được nhận tiêu chí cũ và phần mới có quyền ghi đè.
    it('reuses criteria for an explicit clearance follow-up after clarification', () => {
        const result = resolveAgentClearanceFollowUp({
            recentMessages: [
                makeMessage(
                    'user',
                    '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
                ),
                makeMessage(
                    'assistant',
                    'Kỳ thống kê chỉ hỗ trợ 7, 30 hoặc 90 ngày. Bạn chọn một kỳ này giúp mình nhé.',
                ),
            ],
            modeSessionId: 'session-1',
            question: '@xả-hàng 90 ngày đi',
        });

        expect(result).toEqual({
            message: '@xả-hàng 90 ngày đi',
            contextMessages: [
                '@xả-hàng tồn ít nhất 20, bán tối đa 1 trong 60 ngày, giảm 10%, giá sàn 150.000đ',
            ],
        });
    });
});
