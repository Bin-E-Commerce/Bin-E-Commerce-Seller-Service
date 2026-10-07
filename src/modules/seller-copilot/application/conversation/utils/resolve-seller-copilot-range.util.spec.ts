// Kiểm thử nhận diện kỳ báo cáo từ câu hỏi tiếng Việt mà không gọi AI hoặc truy cập dashboard.
import { resolveSellerCopilotRange } from '@/modules/seller-copilot/application/conversation/utils/resolve-seller-copilot-range.util';

describe('resolveSellerCopilotRange', () => {
    // Tên tháng có dấu được chuẩn hóa trước khi so khớp và ghi đè lựa chọn cũ từ client.
    it('should prefer an explicit current month over a legacy range', () => {
        // Arrange
        const message = 'Doanh thu shop trong tháng này thế nào?';

        // Act
        const result = resolveSellerCopilotRange(message, '90d');

        // Assert
        expect(result).toBe('current-month');
    });

    // Các kỳ cụ thể chỉ được chọn khi người bán nêu rõ trong câu hỏi.
    it('should resolve explicit day ranges from Vietnamese wording', () => {
        // Arrange / Act / Assert
        expect(resolveSellerCopilotRange('Báo cáo 7 ngày gần đây')).toBe('7d');
        expect(resolveSellerCopilotRange('Doanh thu 90 ngày qua')).toBe('90d');
    });

    // Tháng có tên cụ thể là kỳ lịch; khi thiếu năm chọn lần xuất hiện gần nhất không nằm ở tương lai.
    it('should resolve a named calendar month and infer its year', () => {
        // Arrange
        const now = new Date('2026-10-06T12:00:00.000Z');

        // Act / Assert
        expect(
            resolveSellerCopilotRange('Doanh thu tháng 9', undefined, now),
        ).toBe('calendar-month:2026-09');
        expect(
            resolveSellerCopilotRange('Doanh thu tháng 12', undefined, now),
        ).toBe('calendar-month:2025-12');
        expect(
            resolveSellerCopilotRange(
                'Doanh thu tháng 9 năm 2024',
                undefined,
                now,
            ),
        ).toBe('calendar-month:2024-09');
        // Dấu gạch chéo là cách người dùng ghi tháng/năm phổ biến; năm phải được giữ nguyên thay vì đoán theo đồng hồ server.
        expect(
            resolveSellerCopilotRange(
                'Sản phẩm nào bán chạy nhất tháng 9/2026?',
                undefined,
                new Date('2027-10-06T12:00:00.000Z'),
            ),
        ).toBe('calendar-month:2026-09');
        expect(
            resolveSellerCopilotRange('Doanh thu tháng 1-2025', undefined, now),
        ).toBe('calendar-month:2025-01');
    });

    // “Trong tháng 9” là tháng lịch được nêu, không phải cụm “trong tháng này” của tháng hiện tại.
    it('should prefer an explicit month number over the current-month phrase', () => {
        // Arrange
        const now = new Date('2026-10-07T08:00:00.000Z');

        // Act / Assert
        expect(
            resolveSellerCopilotRange(
                'Trong tháng 9 có những ngày nào phát sinh doanh thu?',
                undefined,
                now,
            ),
        ).toBe('calendar-month:2026-09');
        expect(
            resolveSellerCopilotRange(
                'Doanh thu trong tháng này',
                undefined,
                now,
            ),
        ).toBe('current-month');
    });

    // “Tháng trước” là tháng lịch trước và tháng vượt 12 không được chọn thành kỳ giả.
    it('should resolve the previous calendar month and reject an invalid month', () => {
        // Arrange
        const now = new Date('2026-10-06T12:00:00.000Z');

        // Act / Assert
        expect(
            resolveSellerCopilotRange('Doanh thu tháng trước', undefined, now),
        ).toBe('calendar-month:2026-09');
        expect(
            resolveSellerCopilotRange('Doanh thu tháng 13', undefined, now),
        ).toBeNull();
    });

    // Câu không nêu kỳ dùng range legacy nếu có; nếu không thì giữ mặc định sản phẩm 30 ngày.
    it('should preserve a legacy range or default to 30 days when unspecified', () => {
        // Arrange / Act / Assert
        expect(resolveSellerCopilotRange('Doanh thu shop thế nào?', '7d')).toBe(
            '7d',
        );
        expect(resolveSellerCopilotRange('Doanh thu shop thế nào?')).toBe(
            '30d',
        );
    });

    // Mốc được nêu nhưng chưa hỗ trợ phải trả null để use case hỏi lại, không lấy nhầm 30 ngày.
    it('should reject an explicit unsupported period instead of silently defaulting', () => {
        // Arrange / Act / Assert
        expect(resolveSellerCopilotRange('Doanh thu 15 ngày qua')).toBeNull();
        expect(resolveSellerCopilotRange('Doanh thu năm ngoái')).toBeNull();
    });
});
