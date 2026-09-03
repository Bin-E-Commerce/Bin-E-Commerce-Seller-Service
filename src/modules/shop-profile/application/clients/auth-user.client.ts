// Client nội bộ đọc activity tối thiểu của owner từ Auth Service.
// Seller chỉ nhận timestamp và không phụ thuộc vào session/token detail của user.

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface UserActivityResponse {
  lastActiveAt: string | null;
}

// Client nội bộ tối giản, chỉ phụ thuộc vào contract activity public của Auth Service.
@Injectable()
export class AuthUserClient {
  private readonly authServiceUrl: string;
  private readonly internalServiceToken: string;

  // Đọc URL và shared secret một lần để mọi request nội bộ dùng cùng cấu hình.
  constructor(config: ConfigService) {
    this.authServiceUrl = config.get<string>(
      "AUTH_SERVICE_URL",
      "http://localhost:3002",
    );
    this.internalServiceToken = config.get<string>(
      "INTERNAL_SERVICE_TOKEN",
      "dev-media-auth-internal-secret",
    );
  }

  // Activity không phải điều kiện để xem shop nên lỗi Auth chỉ trả null thay vì làm hỏng trang public.
  async getLastActiveAt(userId: string): Promise<Date | null> {
    const response = await fetch(
      `${this.authServiceUrl}/api/v1/internal/users/${userId}/activity`,
      {
        headers: { "x-internal-service-token": this.internalServiceToken },
        signal: AbortSignal.timeout(2_000),
      },
    ).catch(() => null);

    if (!response?.ok) return null;
    const payload = (await response.json()) as UserActivityResponse;
    if (!payload.lastActiveAt) return null;

    const date = new Date(payload.lastActiveAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
