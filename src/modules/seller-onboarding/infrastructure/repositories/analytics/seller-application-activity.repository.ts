// Adapter thống kê hồ sơ chỉ đọc, nhóm theo thời điểm seller gửi yêu cầu chứ không theo ngày admin cập nhật.
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
    SellerApplicationActivityDailyCount,
    SellerApplicationActivityRepositoryPort,
} from '@/modules/seller-onboarding/application/contracts/seller-application-activity.repository';

@Injectable()
export class SellerApplicationActivityRepository
    implements SellerApplicationActivityRepositoryPort
{
    constructor(private readonly dataSource: DataSource) {}

    // submitted_at chỉ được gán khi gửi duyệt; ngày hiển thị dùng giờ Việt Nam còn bộ lọc giữ timestamp index-friendly.
    async getSubmittedApplicationsDaily(
        from: string,
        to: string,
    ): Promise<SellerApplicationActivityDailyCount[]> {
        return this.dataSource.query(
            `
                SELECT
                    TO_CHAR(application.submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS count
                FROM seller_applications application
                WHERE application.submitted_at IS NOT NULL
                  AND application.submitted_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                  AND application.submitted_at < ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
                GROUP BY (application.submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                ORDER BY day ASC
            `,
            [from, to],
        );
    }
}
