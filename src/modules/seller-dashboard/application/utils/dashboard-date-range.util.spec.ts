// Unit test bảo vệ timezone và giới hạn range, vì sai ngày sẽ làm sai toàn bộ chart doanh thu.
/// <reference types="jest" />

import {
    createDashboardDateRange,
    fillDashboardTrend,
    normalizeDashboardRange,
} from '@/modules/seller-dashboard/application/utils/dashboard-date-range.util';

describe('dashboard-date-range.util', () => {
    // Range không hợp lệ phải quay về 30 ngày để query không nhận khoảng tùy ý.
    it('normalizes unknown range to 30d', () => {
        expect(normalizeDashboardRange('unknown')).toBe('30d');
        expect(normalizeDashboardRange('7d')).toBe('7d');
        expect(normalizeDashboardRange('90d')).toBe('90d');
    });

    // Mốc ngày phải bắt đầu từ nửa đêm Việt Nam dù test chạy trên timezone máy khác.
    it('creates a Vietnam-local date range', () => {
        const range = createDashboardDateRange(
            '7d',
            new Date('2026-09-26T10:00:00.000Z'),
        );

        expect(range.from).toBe('2026-09-19T17:00:00.000Z');
        expect(range.previousFrom).toBe('2026-09-12T17:00:00.000Z');
        expect(range.previousTo).toBe('2026-09-19T17:00:00.000Z');
    });

    // Những ngày không có đơn vẫn phải xuất hiện với giá trị 0 để đường biểu đồ không bị đứt sai.
    it('fills missing trend days with zero values', () => {
        const range = createDashboardDateRange(
            '7d',
            new Date('2026-09-26T10:00:00.000Z'),
        );

        const trend = fillDashboardTrend(
            [
                {
                    date: '2026-09-21',
                    grossRevenue: 100000,
                    orderCount: 1,
                },
            ],
            range,
        );

        expect(trend).toHaveLength(7);
        expect(trend.find((point) => point.date === '2026-09-21')).toEqual({
            date: '2026-09-21',
            grossRevenue: 100000,
            orderCount: 1,
        });
        // range.from là 00:00 Việt Nam, tương ứng 17:00 UTC ngày hôm trước.
        // Khóa ngày của chart phải bắt đầu từ ngày 20 theo lịch Việt Nam.
        expect(trend[0]).toEqual({
            date: '2026-09-20',
            grossRevenue: 0,
            orderCount: 0,
        });
        expect(trend.at(-1)?.date).toBe('2026-09-26');
    });
});
