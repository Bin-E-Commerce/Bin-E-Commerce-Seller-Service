// Tạo khoảng thời gian theo ngày Việt Nam, tránh việc chart bị lệch ngày khi server chạy UTC.

import type {
    SellerDashboardDateRange,
    SellerDashboardRange,
} from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const RANGE_DAYS: Record<'7d' | '30d' | '90d' | 'current-month', number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    'current-month': 0,
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
    // `to` là biên loại trừ; lùi 1ms để nhãn luôn hiển thị ngày cuối thực sự thuộc kỳ.
    const exclusiveEnd = new Date(range.to);
    if (Number.isNaN(exclusiveEnd.getTime())) {
        return `${formatSellerDashboardDate(range.from)} đến ${range.to}`;
    }

    return `${formatSellerDashboardDate(range.from)} đến ${formatSellerDashboardDate(new Date(exclusiveEnd.getTime() - 1).toISOString())}`;
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

// Chuẩn hóa range hợp lệ; current-month là khoảng lịch có biên Việt Nam, còn giá trị lạ an toàn về 30 ngày.
export function normalizeDashboardRange(value?: string): SellerDashboardRange {
    if (
        value === '7d' ||
        value === '30d' ||
        value === '90d' ||
        value === 'current-month'
    ) {
        return value;
    }

    // Chỉ nhận tháng YYYY-MM hợp lệ; chuỗi tháng sai không được âm thầm biến thành kỳ báo cáo khác.
    if (value && /^calendar-month:\d{4}-(0[1-9]|1[0-2])$/u.test(value)) {
        return value as SellerDashboardRange;
    }

    return '30d';
}

// Tạo biên kỳ dashboard theo ngày Việt Nam; current-month là MTD so với toàn bộ tháng lịch liền trước.
// Các range cố định vẫn giữ chính xác độ dài cũ, không phụ thuộc timezone của máy chạy service.
export function createDashboardDateRange(
    range: SellerDashboardRange,
    now = new Date(),
): SellerDashboardDateRange {
    // Tính ngày bắt đầu hôm nay tại Việt Nam một lần; các kỳ 7/30/90 ngày lấy ngày này làm mốc thay vì UTC server.
    const todayStart = getVietnamTodayStart(now);
    if (range === 'current-month') {
        // MTD dùng ngày đầu tháng hiện tại tới đúng instant now, tránh bao gồm thời gian tương lai trong ngày.
        const vietnamNow = new Date(now.getTime() + VIETNAM_OFFSET_MS);
        const year = vietnamNow.getUTCFullYear();
        const month = vietnamNow.getUTCMonth();
        const from = new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS);
        const previousMonthStart = new Date(
            Date.UTC(year, month - 1, 1) - VIETNAM_OFFSET_MS,
        );
        // Lấy đúng phần cuối tháng trước bằng mốc đầu tháng hiện tại trừ 1ms;
        // cách này bao phủ mọi ngày tháng trước và tự xử lý tháng ngắn, năm nhuận, chuyển năm.
        const previousTo = from;

        return {
            key: range,
            from: from.toISOString(),
            to: new Date(now).toISOString(),
            previousFrom: previousMonthStart.toISOString(),
            previousTo: previousTo.toISOString(),
        };
    }

    // Tháng lịch cụ thể dùng khoảng [đầu tháng, đầu tháng kế tiếp), phù hợp trực tiếp với truy vấn SQL >= / <.
    const calendarMonth = /^calendar-month:(\d{4})-(\d{2})$/u.exec(range);
    if (calendarMonth) {
        const year = Number(calendarMonth[1]);
        const month = Number(calendarMonth[2]) - 1;
        const from = new Date(Date.UTC(year, month, 1) - VIETNAM_OFFSET_MS);
        const to = new Date(Date.UTC(year, month + 1, 1) - VIETNAM_OFFSET_MS);
        const previousFrom = new Date(
            Date.UTC(year, month - 1, 1) - VIETNAM_OFFSET_MS,
        );

        return {
            key: range,
            from: from.toISOString(),
            to: to.toISOString(),
            previousFrom: previousFrom.toISOString(),
            previousTo: from.toISOString(),
        };
    }

    const days = RANGE_DAYS[range as '7d' | '30d' | '90d' | 'current-month'];
    // Ngày đầu kỳ được tính inclusive (hôm nay là ngày thứ nhất), kỳ trước liền kề và có cùng số ngày.
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

// Bổ sung ngày không có giao dịch; số điểm được tính từ hai biên ngày Việt Nam để cả kỳ tháng và kỳ cố định khớp nhau.
export function fillDashboardTrend(
    points: Array<{
        date: string;
        grossRevenue: number;
        orderCount: number;
    }>,
    range: SellerDashboardDateRange,
): Array<{ date: string; grossRevenue: number; orderCount: number }> {
    // Range.to là instant hiện tại nhưng chart làm việc theo ngày; quy về đầu ngày Việt Nam để số điểm không bị lệch do giờ UTC.
    const start = new Date(range.from);
    // `to` là biên loại trừ nên chart kết thúc tại ngày chứa instant cuối cùng thuộc kỳ.
    const end = getVietnamTodayStart(
        new Date(new Date(range.to).getTime() - 1),
    );
    // Kỳ đã được chuẩn hóa về biên ngày nên cộng ngày UTC 24 giờ là ổn định, không chịu DST của timezone máy chủ.
    const days =
        Math.floor(
            (end.getTime() - getVietnamTodayStart(start).getTime()) / 86400000,
        ) + 1;
    const pointByDate = new Map(points.map((point) => [point.date, point]));

    // Tạo đủ từng ngày trong range; ngày không có giao dịch hiện 0 thay vì bị bỏ khỏi chuỗi và làm chart đứt đoạn.
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
