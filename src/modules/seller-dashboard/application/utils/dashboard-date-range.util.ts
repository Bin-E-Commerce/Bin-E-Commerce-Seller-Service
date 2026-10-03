// Tạo khoảng thời gian theo ngày Việt Nam, tránh việc chart bị lệch ngày khi server chạy UTC.

import type {
    SellerDashboardDateRange,
    SellerDashboardRange,
} from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const RANGE_DAYS: Record<SellerDashboardRange, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
};

const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

// Hiển thị ngày theo múi giờ nghiệp vụ của seller thay vì đẩy chuỗi ISO nội bộ ra UI.
// Ngày lỗi được giữ nguyên để không biến dữ liệu bất thường thành một ngày giả.
export function formatSellerDashboardDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : VIETNAM_DATE_FORMATTER.format(date);
}

// Format khoảng thời gian thành câu ngắn, dễ đọc trong answer và citation popup.
export function formatSellerDashboardDateRange(
    range: Pick<SellerDashboardDateRange, 'from' | 'to'>,
): string {
    return `${formatSellerDashboardDate(range.from)} đến ${formatSellerDashboardDate(range.to)}`;
}

// Đổi instant UTC về khóa ngày theo múi giờ Việt Nam để chart dùng đúng ngày nghiệp vụ.
// Không dùng trực tiếp toISOString().slice(0, 10) vì 00:00 Việt Nam là 17:00 UTC của ngày trước.
function toVietnamDateKey(date: Date): string {
    return new Date(date.getTime() + VIETNAM_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
}

// Trả ngày hiện tại theo lịch Việt Nam dưới dạng UTC midnight rồi quy đổi về instant UTC.
function getVietnamTodayStart(now: Date): Date {
    const vietnamNow = new Date(now.getTime() + VIETNAM_OFFSET_MS);
    const year = vietnamNow.getUTCFullYear();
    const month = vietnamNow.getUTCMonth();
    const day = vietnamNow.getUTCDate();
    return new Date(Date.UTC(year, month, day) - VIETNAM_OFFSET_MS);
}

// Chuẩn hóa range hợp lệ để query không thể yêu cầu khoảng thời gian vô hạn.
export function normalizeDashboardRange(value?: string): SellerDashboardRange {
    return value === '7d' || value === '90d' ? value : '30d';
}

// Tạo current/previous period có cùng độ dài để backend tính phần trăm thay đổi nhất quán.
export function createDashboardDateRange(
    range: SellerDashboardRange,
    now = new Date(),
): SellerDashboardDateRange {
    const days = RANGE_DAYS[range];
    const todayStart = getVietnamTodayStart(now);
    const from = new Date(todayStart.getTime() - (days - 1) * 86400000);
    const to = new Date(now);
    const previousTo = new Date(from);
    const previousFrom = new Date(previousTo.getTime() - days * 86400000);

    return {
        key: range,
        from: from.toISOString(),
        to: to.toISOString(),
        previousFrom: previousFrom.toISOString(),
        previousTo: previousTo.toISOString(),
    };
}

// Bổ sung ngày không có giao dịch để biểu đồ luôn có đủ số điểm theo range đã chọn.
export function fillDashboardTrend(
    points: Array<{
        date: string;
        grossRevenue: number;
        orderCount: number;
    }>,
    range: SellerDashboardDateRange,
): Array<{ date: string; grossRevenue: number; orderCount: number }> {
    const days = RANGE_DAYS[range.key];
    const start = new Date(range.from);
    const pointByDate = new Map(points.map((point) => [point.date, point]));

    return Array.from({ length: days }, (_, index) => {
        const date = toVietnamDateKey(
            new Date(start.getTime() + index * 86400000),
        );
        return (
            pointByDate.get(date) ?? {
                date,
                grossRevenue: 0,
                orderCount: 0,
            }
        );
    });
}
