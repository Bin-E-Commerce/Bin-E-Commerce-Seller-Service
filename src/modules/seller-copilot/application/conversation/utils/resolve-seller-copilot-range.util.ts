// Xác định kỳ dashboard từ ngôn ngữ người bán; UI không còn bắt họ chọn ngày trước mỗi câu hỏi.
import type { SellerCopilotRange } from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { SellerDashboardRange } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

// Chuẩn hóa một số cách nói phổ biến trước khi kiểm tra period; không cố đoán ngày tùy ý từ câu hỏi.
export function resolveSellerCopilotRange(
    message: string,
    legacyRange?: SellerCopilotRange,
    now = new Date(),
): SellerDashboardRange | null {
    const normalized = message
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLocaleLowerCase('vi')
        .replace(/đ/gu, 'd');

    // Tháng hiện tại phải đi trước cụm “30 ngày” để không làm mất ranh giới lịch tháng.
    if (/thang nay|thang hien tai|trong thang(?!\s+\d)/iu.test(normalized)) {
        return 'current-month';
    }

    // Tháng được nêu tường minh có ưu tiên hơn cụm “tháng trước”; năm bị lược sẽ chọn lần xuất hiện gần nhất không ở tương lai.
    // Chấp nhận cách ghi tháng/năm thường gặp trên chat: “tháng 9/2026”, “tháng 9-2026” và “tháng 9 năm 2026”.
    // Nếu năm không có, logic phía dưới mới suy luận năm gần nhất; không để dấu phân cách làm rơi mất năm người dùng đã chỉ định.
    const explicitMonth =
        /thang\s+(\d{1,2})(?:(?:\s*[/-]\s*|\s+nam\s+|\s+)(\d{4}))?/iu.exec(
            normalized,
        );
    if (explicitMonth) {
        const month = Number(explicitMonth[1]);
        const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const currentYear = vietnamNow.getUTCFullYear();
        const currentMonth = vietnamNow.getUTCMonth() + 1;
        const explicitYear = explicitMonth[2]
            ? Number(explicitMonth[2])
            : month > currentMonth
              ? currentYear - 1
              : currentYear;

        if (month >= 1 && month <= 12 && explicitYear >= 2000) {
            return `calendar-month:${explicitYear}-${String(month).padStart(2, '0')}` as SellerDashboardRange;
        }
        return null;
    }

    // “Tháng trước” không cần hỏi lại; chuyển thành tháng lịch liền trước thay vì một số ngày gần nhất.
    if (/thang truoc/iu.test(normalized)) {
        const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const previousMonth = new Date(
            Date.UTC(
                vietnamNow.getUTCFullYear(),
                vietnamNow.getUTCMonth() - 1,
                1,
            ),
        );
        return `calendar-month:${previousMonth.getUTCFullYear()}-${String(previousMonth.getUTCMonth() + 1).padStart(2, '0')}` as SellerDashboardRange;
    }

    // Chỉ nhận các mốc được dashboard hỗ trợ; câu thời gian không rõ không bị âm thầm đổi thành một kỳ khác.
    if (/90\s*ngay|ba thang|3 thang/iu.test(normalized)) return '90d';
    if (/7\s*ngay|mot tuan|1 tuan|tuan qua|tuan nay/iu.test(normalized)) {
        return '7d';
    }
    if (/30\s*ngay|mot thang|1 thang/iu.test(normalized)) {
        return '30d';
    }

    // Mốc có nêu nhưng nằm ngoài tập dashboard không được tráo thành 30 ngày; caller sẽ hỏi lại thay vì báo sai kỳ.
    if (
        /\d+\s*ngay|hom nay|hom qua|tuan truoc|quy|nam nay|nam truoc|nam ngoai/iu.test(
            normalized,
        )
    ) {
        return null;
    }

    // Client cũ vẫn gửi range; request mới không có field này nên dùng mặc định ổn định 30 ngày.
    return legacyRange ?? '30d';
}
