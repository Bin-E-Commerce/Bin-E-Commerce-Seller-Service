// Kiểm thử biên ngày của dashboard theo múi giờ nghiệp vụ Việt Nam.
import {
    createDashboardDateRange,
    fillDashboardTrend,
} from '@/modules/seller-dashboard/application/utils/dashboard-date-range.util';

describe('dashboard-date-range.util', () => {
    // Kỳ hiện tại là MTD, còn kỳ trước bao phủ từ đầu đến cuối tháng lịch liền trước.
    it('should compare month-to-date with the entire previous calendar month', () => {
        // Arrange
        const now = new Date('2026-10-06T12:00:00.000Z');

        // Act
        const result = createDashboardDateRange('current-month', now);

        // Assert
        expect(result).toEqual({
            key: 'current-month',
            from: '2026-09-30T17:00:00.000Z',
            to: '2026-10-06T12:00:00.000Z',
            previousFrom: '2026-08-31T17:00:00.000Z',
            previousTo: '2026-09-30T17:00:00.000Z',
        });
    });

    // Tháng lịch dùng biên loại trừ đầu tháng kế tiếp và so với trọn tháng liền trước.
    it('should create exact calendar-month ranges across a year boundary', () => {
        // Arrange / Act
        const result = createDashboardDateRange(
            'calendar-month:2026-01',
            new Date('2026-10-06T12:00:00.000Z'),
        );

        // Assert
        expect(result).toEqual({
            key: 'calendar-month:2026-01',
            from: '2025-12-31T17:00:00.000Z',
            to: '2026-01-31T17:00:00.000Z',
            previousFrom: '2025-11-30T17:00:00.000Z',
            previousTo: '2025-12-31T17:00:00.000Z',
        });
    });

    // Biểu đồ và nhãn range bỏ biên loại trừ để tháng 9 chỉ có điểm từ ngày 1 đến ngày 30.
    it('should fill and format an exact calendar month without including the next month', () => {
        // Arrange
        const range = createDashboardDateRange(
            'calendar-month:2026-09',
            new Date('2026-10-06T12:00:00.000Z'),
        );

        // Act
        const points = fillDashboardTrend([], range);

        // Assert
        expect(points).toHaveLength(30);
        expect(points[0]?.date).toBe('2026-09-01');
        expect(points[29]?.date).toBe('2026-09-30');
    });

    // Chart tháng hiện tại có đúng một điểm mỗi ngày đã bắt đầu theo lịch Việt Nam.
    it('should fill every elapsed Vietnam calendar day for month-to-date', () => {
        // Arrange
        const range = createDashboardDateRange(
            'current-month',
            new Date('2026-10-06T12:00:00.000Z'),
        );

        // Act
        const result = fillDashboardTrend([], range);

        // Assert
        expect(result.map(({ date }) => date)).toEqual([
            '2026-10-01',
            '2026-10-02',
            '2026-10-03',
            '2026-10-04',
            '2026-10-05',
            '2026-10-06',
        ]);
    });
});
