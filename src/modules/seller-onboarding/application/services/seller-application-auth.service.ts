import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Permission } from "@common/auth";
import { CurrentUserContext } from "../types/current-user-context.type";

@Injectable()
export class SellerApplicationAuthService {
  // Tạo context xác thực duy nhất từ header nội bộ do API Gateway inject; tuyệt đối không lấy userId/email từ request body.
  // Ranh giới tin cậy này chỉ an toàn khi seller-service không được public trực tiếp ra Internet.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): CurrentUserContext {
    const userId = this.getHeaderValue(headers, "x-user-id");
    const email = this.getHeaderValue(headers, "x-user-email");
    const rolesHeader = this.getHeaderValue(headers, "x-user-roles") ?? "";
    const permissionsHeader =
      this.getHeaderValue(headers, "x-user-permissions") ?? "";

    // Header role và permission là chuỗi phân cách bằng dấu phẩy để gateway truyền qua HTTP mà không làm mất nhiều giá trị.
    return {
      userId: userId ?? "",
      email: email ?? "",
      roles: this.parseHeaderList(rolesHeader),
      permissions: this.parseHeaderList(permissionsHeader),
    };
  }

  // Chặn request thiếu danh tính trước khi truy vấn DB; email cũng bắt buộc vì được dùng làm địa chỉ nhận thông báo hồ sơ.
  ensureAuthenticatedUser(currentUser: CurrentUserContext): CurrentUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để đăng ký người bán.",
      );
    }

    return currentUser;
  }

  // Kiểm tra permission cụ thể thay vì tên role để ADMIN và SUPPORT_AGENT có thể dùng chung nghiệp vụ review theo RBAC.
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

  // Bảo vệ riêng thao tác từ chối vì quyền đọc hồ sơ không đồng nghĩa với quyền thay đổi trạng thái hồ sơ.
  ensureCanRejectApplication(
    currentUser: CurrentUserContext,
  ): CurrentUserContext {
    const user = this.ensureAuthenticatedUser(currentUser);

    if (!user.permissions.includes(Permission.SELLER_APPLICATION_REJECT)) {
      throw new ForbiddenException(
        "Bạn không có quyền từ chối hồ sơ đăng ký người bán.",
      );
    }

    return user;
  }

  // Bảo vệ riêng thao tác duyệt vì quyền xem hồ sơ không đồng nghĩa với quyền kích hoạt người bán.
  ensureCanApproveApplication(
    currentUser: CurrentUserContext,
  ): CurrentUserContext {
    const user = this.ensureAuthenticatedUser(currentUser);

    if (!user.permissions.includes(Permission.SELLER_APPLICATION_APPROVE)) {
      throw new ForbiddenException(
        "Bạn không có quyền chấp thuận hồ sơ đăng ký người bán.",
      );
    }

    return user;
  }

  // Đọc an toàn cả header đơn và header lặp; Node/Nest chuẩn hóa tên header request thành lowercase.
  private getHeaderValue(
    headers: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }

  // Loại khoảng trắng và phần tử rỗng để phép includes() phía sau không bị sai vì định dạng header.
  private parseHeaderList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
