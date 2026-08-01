import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Permission } from "@common/auth";
import { ShopUserContext } from "../types/shop-user-context.type";

@Injectable()
export class ShopProfileAccessService {
  // Dựng context từ các header đã được API Gateway xác thực; tuyệt đối không tin ownerUserId do frontend gửi lên.
  buildCurrentUserFromHeaders(
    headers: Record<string, unknown>,
  ): ShopUserContext {
    return {
      userId: this.getHeaderValue(headers, "x-user-id") ?? "",
      email: this.getHeaderValue(headers, "x-user-email") ?? "",
      permissions: this.parseHeaderList(
        this.getHeaderValue(headers, "x-user-permissions") ?? "",
      ),
    };
  }

  // Chỉ cho phép đọc hồ sơ của chính shop khi access profile hiện tại có quyền tương ứng.
  ensureCanRead(currentUser: ShopUserContext): ShopUserContext {
    return this.ensurePermission(
      currentUser,
      Permission.SELLER_SHOP_PROFILE_READ,
      "Bạn không có quyền xem hồ sơ shop.",
    );
  }

  // Tách quyền cập nhật khỏi quyền đọc để có thể cấp tài khoản nhân viên shop chỉ được xem trong tương lai.
  ensureCanUpdate(currentUser: ShopUserContext): ShopUserContext {
    return this.ensurePermission(
      currentUser,
      Permission.SELLER_SHOP_PROFILE_UPDATE,
      "Bạn không có quyền chỉnh sửa hồ sơ shop.",
    );
  }

  // Trả capability cho giao diện mà không ném lỗi, giúp FE ẩn thao tác cập nhật thay vì phải tự sao chép mã permission.
  canUpdate(currentUser: ShopUserContext): boolean {
    return currentUser.permissions.includes(
      Permission.SELLER_SHOP_PROFILE_UPDATE,
    );
  }

  // Kiểm tra danh tính và permission tại service để bảo vệ cả trường hợp service bị gọi ngoài API Gateway.
  private ensurePermission(
    currentUser: ShopUserContext,
    permission: Permission,
    message: string,
  ): ShopUserContext {
    if (!currentUser.userId || !currentUser.email) {
      throw new UnauthorizedException(
        "Bạn cần đăng nhập để quản lý hồ sơ shop.",
      );
    }

    if (!currentUser.permissions.includes(permission)) {
      throw new ForbiddenException(message);
    }

    return currentUser;
  }

  // Đọc an toàn header đơn hoặc header lặp vì Node chuẩn hóa toàn bộ tên header thành lowercase.
  private getHeaderValue(
    headers: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return typeof value === "string" ? value : undefined;
  }

  // Chuẩn hóa danh sách permission phân cách bằng dấu phẩy trước khi thực hiện kiểm tra chính xác.
  private parseHeaderList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
