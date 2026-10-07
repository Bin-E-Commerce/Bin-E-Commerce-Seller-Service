// Client nội bộ cho tác nhân tồn kho; Product Service xác minh quyền, ownership và transaction cuối cùng.
import {
    BadGatewayException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerInventorySearchResult } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Adapter service-to-service cho truy vấn candidate và cập nhật tồn khả dụng.
// Shared token chỉ chứng minh request nội bộ; Product Service vẫn xác minh seller, shop ownership, permission và số tồn mong đợi.
@Injectable()
export class SellerInventoryAgentClient {
    private readonly productServiceUrl: string;
    private readonly internalServiceToken: string;

    // Dùng cùng cấu hình service-to-service hiện có, không đưa credential vào request từ browser.
    constructor(config: ConfigService) {
        this.productServiceUrl = config.get<string>(
            'PRODUCT_SERVICE_URL',
            'http://localhost:3008',
        );
        this.internalServiceToken = config.get<string>(
            'INTERNAL_SERVICE_TOKEN',
            '',
        );
    }

    // Search chỉ đọc tối đa mười candidate trong shop đã resolve; caller phải tự hỏi lại nếu tên/biến thể trùng.
    async search(
        shopId: string,
        query: string,
    ): Promise<SellerInventorySearchResult[]> {
        // URLSearchParams mã hóa ký tự tên/SKU để dữ liệu người bán không thể làm biến dạng query string.
        const params = new URLSearchParams({ q: query });
        const response = await fetch(
            `${this.productServiceUrl}/api/v1/internal/products/shops/${shopId}/inventory/search?${params}`,
            {
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.internalServiceToken,
                },
                signal: AbortSignal.timeout(5_000),
            },
        ).catch(() => null);
        // Mạng lỗi, timeout hoặc HTTP lỗi đều được chuẩn hóa thành gateway error; không biến thành kết quả rỗng gây chọn nhầm.
        if (!response?.ok) {
            throw new BadGatewayException(
                'Product Service chưa thể tìm sản phẩm để cập nhật tồn kho.',
            );
        }
        return (await response.json()) as SellerInventorySearchResult[];
    }

    // Đọc catalog seller đã giới hạn ở Product Service; request dùng shop scope đã resolve, không nhận identity từ browser.
    async getProductCatalog(
        shopId: string,
        ownerUserId: string,
    ): Promise<SellerCopilotProductCatalogSnapshot> {
        // Shop và owner đều đến từ scope đã xác thực; owner bổ sung khả năng đọc sản phẩm legacy chỉ thiếu seller_shop_id.
        const query = new URLSearchParams({ ownerUserId });
        const response = await fetch(
            `${this.productServiceUrl}/api/v1/internal/products/shops/${shopId}/catalog?${query}`,
            {
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.internalServiceToken,
                },
                signal: AbortSignal.timeout(5_000),
            },
        ).catch(() => null);

        // Không trả snapshot giả khi downstream lỗi; caller cần biết nguồn catalog không thể dùng.
        if (!response?.ok) {
            throw new BadGatewayException(
                'Product Service chưa thể tải danh sách sản phẩm của shop.',
            );
        }

        return (await response.json()) as SellerCopilotProductCatalogSnapshot;
    }

    // Gửi preview với identity/permission do API Gateway xác thực; Product Service vẫn kiểm tra lại mọi điều kiện ghi.
    async setAvailable(input: {
        shopId: string;
        ownerUserId: string;
        email: string;
        permissions: string[];
        variantId: string;
        expectedAvailable: number;
        nextAvailable: number;
    }): Promise<{ variantId: string; available: number; reserved: number }> {
        // expectedAvailable đóng vai trò compare-and-set để chặn ghi đè khi tồn đã đổi sau lúc tạo preview.
        const response = await fetch(
            `${this.productServiceUrl}/api/v1/internal/products/shops/${input.shopId}/inventory/${input.variantId}/available`,
            {
                method: 'PATCH',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-internal-service-token': this.internalServiceToken,
                    'x-user-id': input.ownerUserId,
                    'x-user-email': input.email,
                    'x-user-permissions': input.permissions.join(','),
                },
                body: JSON.stringify({
                    expectedAvailable: input.expectedAvailable,
                    nextAvailable: input.nextAvailable,
                }),
                signal: AbortSignal.timeout(8_000),
            },
        ).catch(() => null);
        // 409 là xung đột dữ liệu có thể xử lý bằng preview mới, khác với lỗi gateway không xác định kết quả ghi.
        if (response?.status === 409) {
            throw new ConflictException(
                'Tồn kho đã thay đổi sau khi xem trước. Hãy tạo yêu cầu mới với số lượng cập nhật.',
            );
        }
        // Các lỗi còn lại không khẳng định được thao tác thành công; không parse body lỗi thành kết quả tồn kho.
        if (!response?.ok) {
            throw new BadGatewayException(
                'Không thể cập nhật tồn kho lúc này; chưa xác nhận được kết quả ghi.',
            );
        }
        return (await response.json()) as {
            variantId: string;
            available: number;
            reserved: number;
        };
    }
}
