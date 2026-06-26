import { Injectable, UnauthorizedException } from "@nestjs/common";
import { CurrentUserContext } from "../types/current-user-context.type";

@Injectable()
export class SellerApplicationAuthService {
  // Tạo context user từ headers do API Gateway inject; service không tin dữ liệu truyền từ body.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): CurrentUserContext {
    const userId = this.getHeaderValue(headers, "x-user-id");
    const email = this.getHeaderValue(headers, "x-user-email");
    const rolesHeader = this.getHeaderValue(headers, "x-user-roles") ?? "";

    return {
      userId: userId ?? "",
      email: email ?? "",
      roles: rolesHeader
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
    };
  }

  // Đảm bảo downstream chỉ xử lý người dùng đã đăng nhập và đã có email trong token.
  ensureAuthenticatedUser(
    currentUser: CurrentUserContext,
  ): CurrentUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để đăng ký người bán.",
      );
    }

    return currentUser;
  }

  // Đọc header dạng lowercase vì Node/Nest chuẩn hóa header request thành lowercase.
  private getHeaderValue(
    headers: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }
}
