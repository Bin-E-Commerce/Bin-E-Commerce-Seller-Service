// Client nội bộ đọc activity và allowlist hồ sơ owner từ Auth Service.
// Không truyền credential vào domain seller; endpoint profile chỉ trả trường cần cho hội thoại Copilot.

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface UserActivityResponse {
    lastActiveAt: string | null;
}

interface CopilotProfileResponse {
    data: {
        name: string;
        avatarUrl: string | null;
        email: string;
        phone: string | null;
        role: string;
        status: string;
    };
}

// Adapter chỉ đọc hai hợp đồng nội bộ: thời điểm hoạt động và allowlist hồ sơ cơ bản cho Copilot.
// Không nhận userId từ câu chat và không trả dữ liệu tài chính/định danh nhạy cảm vào model.
@Injectable()
export class AuthUserClient {
    private readonly authServiceUrl: string;
    private readonly internalServiceToken: string;

    // Đọc URL và shared secret một lần để mọi request nội bộ dùng cùng cấu hình.
    constructor(config: ConfigService) {
        this.authServiceUrl = config.get<string>(
            'AUTH_SERVICE_URL',
            'http://localhost:3002',
        );
        this.internalServiceToken = config.get<string>(
            'INTERNAL_SERVICE_TOKEN',
            '',
        );
    }

    // Activity chỉ là thông tin phụ: lỗi mạng, status lỗi hoặc timestamp sai đều trả null thay vì chặn luồng chính.
    // Timeout ngắn giới hạn chi phí chờ; userId chỉ đến từ identity đã xác thực ở Seller Service.
    async getLastActiveAt(userId: string): Promise<Date | null> {
        const response = await fetch(
            `${this.authServiceUrl}/api/v1/internal/users/${userId}/activity`,
            {
                headers: {
                    'x-internal-service-token': this.internalServiceToken,
                },
                signal: AbortSignal.timeout(2_000),
            },
        ).catch(() => null);

        if (!response?.ok) return null;
        const payload = (await response.json()) as UserActivityResponse;
        if (!payload.lastActiveAt) return null;

        const date = new Date(payload.lastActiveAt);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    // Đọc allowlist hồ sơ cơ bản; lỗi Auth được ném lên để caller báo nguồn profile chưa tải được, không tạo hồ sơ giả.
    // Không fallback sang thông tin history hoặc email từ body; userId chỉ do Seller Service lấy từ request đã xác thực.
    async getCopilotProfile(
        userId: string,
    ): Promise<CopilotProfileResponse['data']> {
        const response = await fetch(
            `${this.authServiceUrl}/api/v1/internal/users/copilot-profile`,
            {
                headers: {
                    'x-internal-service-token': this.internalServiceToken,
                    'x-user-id': userId,
                },
                signal: AbortSignal.timeout(3_000),
            },
        ).catch(() => null);

        if (!response?.ok) {
            throw new Error('Auth Service chưa thể tải hồ sơ tài khoản.');
        }

        return ((await response.json()) as CopilotProfileResponse).data;
    }
}
