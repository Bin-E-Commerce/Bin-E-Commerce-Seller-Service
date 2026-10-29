// Use case báo số hồ sơ đã gửi theo ngày; quyền đọc được kiểm tra bằng cùng rule với danh sách hồ sơ admin.
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
    SELLER_APPLICATION_ACTIVITY_REPOSITORY,
    type SellerApplicationActivityRepositoryPort,
} from '@/modules/seller-onboarding/application/contracts/seller-application-activity.repository';
import type { CurrentUserContext } from '@/modules/seller-onboarding/application/types/current-user-context.type';
import { SellerApplicationAuthService } from '@/modules/seller-onboarding/application/services/seller-application-auth.service';

@Injectable()
export class SellerApplicationActivityService {
    constructor(
        private readonly auth: SellerApplicationAuthService,
        @Inject(SELLER_APPLICATION_ACTIVITY_REPOSITORY)
        private readonly repository: SellerApplicationActivityRepositoryPort,
    ) {}

    // Phân quyền trước truy vấn và giới hạn kỳ báo cáo để route dashboard không mở thành endpoint export lịch sử.
    async getSubmittedApplicationsDaily(
        currentUser: CurrentUserContext,
        from: string,
        to: string,
    ) {
        this.auth.ensureStaffUser(currentUser);

        // Parse ngày thuần theo UTC chỉ để tính độ dài; grouping nghiệp vụ theo giờ Việt Nam ở repository.
        const fromDay = Date.parse(`${from}T00:00:00.000Z`);
        const toDay = Date.parse(`${to}T00:00:00.000Z`);
        const dayCount = (toDay - fromDay) / 86_400_000;

        // Từ chối ngày sai thứ tự hoặc cửa sổ quá rộng để dashboard không trở thành endpoint export lịch sử.
        if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 31) {
            throw new BadRequestException(
                'Khoảng thống kê phải từ 1 đến 31 ngày.',
            );
        }

        return {
            from,
            to,
            daily: await this.repository.getSubmittedApplicationsDaily(
                from,
                to,
            ),
        };
    }
}
