import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Permission } from "@common/auth";
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
    const permissionsHeader =
      this.getHeaderValue(headers, "x-user-permissions") ?? "";

    return {
      userId: userId ?? "",
      email: email ?? "",
      roles: this.parseHeaderList(rolesHeader),
      permissions: this.parseHeaderList(permissionsHeader),
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

  // Chỉ tài khoản có quyền đọc hồ sơ seller mới được xem danh sách trong Admin Center.
  ensureStaffUser(currentUser: CurrentUserContext): CurrentUserContext {
    const user = this.ensureAuthenticatedUser(currentUser);
    const hasReviewPermission = user.permissions.includes(
      Permission.SELLER_APPLICATION_READ,
    );

    if (!hasReviewPermission) {
      throw new ForbiddenException(
        "Bạn không có quyền truy cập khu vực quản trị hồ sơ người bán.",
      );
    }

    return user;
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

  // Tách chuỗi header phân cách bằng dấu phẩy thành mảng ổn định để dùng cho role/permission.
  private parseHeaderList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
