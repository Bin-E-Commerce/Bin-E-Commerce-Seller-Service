// Client nội bộ cho tác nhân tồn kho; Product Service xác minh quyền, ownership và transaction cuối cùng.
import {
    BadGatewayException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerInventorySearchResult } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type {
    SellerCopilotProductContentProposalPayload,
    SellerCopilotVariantPriceProposalPayload,
} from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

export interface SellerActiveVariantRecord {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    sellerSku: string | null;
    price: number;
    available: number;
}

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
        const items: SellerCopilotProductCatalogSnapshot['items'] = [];
        let offset = 0;
        let totalCount = 0;
        let hasMore = true;

        // Mỗi page bị giới hạn ở Product Service; offset chỉ tăng theo số dòng nhận được để không bỏ sót bản ghi.
        while (hasMore) {
            const query = new URLSearchParams({
                ownerUserId,
                offset: String(offset),
            });
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

            // Lỗi ở bất kỳ page nào làm snapshot không đầy đủ; fail toàn bộ để Agent không tuyên bố đã rà hết shop.
            if (!response?.ok) {
                throw new BadGatewayException(
                    'Product Service chưa thể tải đầy đủ danh sách sản phẩm của shop.',
                );
            }

            const page =
                (await response.json()) as SellerCopilotProductCatalogSnapshot;
            if (page.items.length === 0 && page.hasMore) {
                throw new BadGatewayException(
                    'Product Service trả trang catalog không hợp lệ.',
                );
            }
            items.push(...page.items);
            totalCount = page.totalCount;
            hasMore = page.hasMore;
            offset += page.items.length;
        }

        return { items, totalCount, hasMore: false };
    }

    // Đọc đúng một trang variant đang bán; caller quản lý offset để đối chiếu sales mà không tải cả catalog vào một response.
    async getActiveVariantPage(input: {
        shopId: string;
        ownerUserId: string;
        offset: number;
        limit: number;
    }): Promise<{ items: SellerActiveVariantRecord[]; hasMore: boolean }> {
        const query = new URLSearchParams({
            ownerUserId: input.ownerUserId,
            offset: String(input.offset),
            limit: String(input.limit),
        });
        const response = await fetch(
            `${this.productServiceUrl}/api/v1/internal/products/shops/${input.shopId}/inventory/active-variants?${query}`,
            {
                headers: {
                    accept: 'application/json',
                    'x-internal-service-token': this.internalServiceToken,
                },
                signal: AbortSignal.timeout(8_000),
            },
        ).catch(() => null);
        if (!response?.ok) {
            throw new BadGatewayException(
                'Product Service chưa thể tải đầy đủ biến thể đang bán của shop.',
            );
        }
        const page = (await response.json()) as {
            items: SellerActiveVariantRecord[];
            hasMore: boolean;
        };
        // Không để row lỗi cấu trúc lọt vào bộ lọc; đặc biệt tồn/giá không hợp lệ không được suy diễn thành candidate.
        if (
            !Array.isArray(page.items) ||
            typeof page.hasMore !== 'boolean' ||
            (page.items.length === 0 && page.hasMore) ||
            page.items.some(
                (variant) =>
                    typeof variant.productId !== 'string' ||
                    typeof variant.productName !== 'string' ||
                    typeof variant.variantId !== 'string' ||
                    typeof variant.variantName !== 'string' ||
                    typeof variant.sku !== 'string' ||
                    (variant.sellerSku !== null &&
                        typeof variant.sellerSku !== 'string') ||
                    !Number.isFinite(variant.price) ||
                    variant.price < 100 ||
                    !Number.isSafeInteger(variant.available) ||
                    variant.available < 0,
            )
        ) {
            throw new BadGatewayException(
                'Product Service trả trang biến thể không hợp lệ.',
            );
        }
        return page;
    }

    // Đọc toàn bộ biến thể dưới ngưỡng theo trang; mỗi trang đều được Product Service giới hạn và scope theo owner/shop.
    async getLowStockVariants(shopId: string, ownerUserId: string) {
        const items: Array<{
            productId: string;
            productName: string;
            variantId: string;
            variantName: string;
            sku: string;
            sellerSku: string | null;
            available: number;
            reserved: number;
            lowStockThreshold: number;
        }> = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore) {
            const query = new URLSearchParams({
                ownerUserId,
                offset: String(offset),
                limit: '100',
            });
            const response = await fetch(
                `${this.productServiceUrl}/api/v1/internal/products/shops/${shopId}/inventory/low-stock?${query}`,
                {
                    headers: {
                        accept: 'application/json',
                        'x-internal-service-token': this.internalServiceToken,
                    },
                    signal: AbortSignal.timeout(8_000),
                },
            ).catch(() => null);
            if (!response?.ok) {
                throw new BadGatewayException(
                    'Product Service chưa thể rà soát đầy đủ tồn kho của shop.',
                );
            }
            const page = (await response.json()) as {
                items: typeof items;
                hasMore: boolean;
            };
            if (
                !Array.isArray(page.items) ||
                (page.items.length === 0 && page.hasMore)
            ) {
                throw new BadGatewayException(
                    'Product Service trả trang tồn kho không hợp lệ.',
                );
            }
            items.push(...page.items);
            offset += page.items.length;
            hasMore = page.hasMore;
            // Chỉ cần biết shop vượt giới hạn batch để hỏi seller lọc; dừng sớm sau 50+ kết quả để tránh tải snapshot quá lớn.
            if (items.length > 50) return items;
        }
        return items;
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

    // Ghi giá cho đúng biến thể với expectedPrice để Product Service từ chối preview đã lỗi thời.
    async setVariantPrice(
        input: SellerCopilotVariantPriceProposalPayload & {
            shopId: string;
            ownerUserId: string;
            email: string;
            permissions: string[];
        },
    ): Promise<{ variantId: string; price: number }> {
        return this.patchAction(
            `/api/v1/internal/products/shops/${input.shopId}/variants/${input.variantId}/price`,
            input,
            {
                expectedPrice: input.expectedPrice,
                nextPrice: input.nextPrice,
                ...(input.minimumPrice !== undefined
                    ? { minimumPrice: input.minimumPrice }
                    : {}),
            },
            'Không thể cập nhật giá lúc này; hãy tạo đề xuất mới nếu giá đã thay đổi.',
        );
    }

    // Cập nhật chỉ tên/mô tả theo expected values; không gửi toàn bộ product graph từ phía Copilot.
    async updateProductContent(
        input: SellerCopilotProductContentProposalPayload & {
            shopId: string;
            ownerUserId: string;
            email: string;
            permissions: string[];
        },
    ): Promise<{
        productId: string;
        name: string;
        description: string | null;
    }> {
        return this.patchAction(
            `/api/v1/internal/products/shops/${input.shopId}/products/${input.productId}/agent-content`,
            input,
            {
                expectedName: input.expectedName,
                nextName: input.nextName,
                expectedDescription: input.expectedDescription,
                nextDescription: input.nextDescription,
            },
            'Không thể cập nhật nội dung lúc này; hãy kiểm tra thông tin sản phẩm rồi tạo đề xuất mới.',
        );
    }

    // Chuẩn hóa header identity và mapping lỗi cho mọi mutation nội bộ; status 409 yêu cầu người bán xem preview mới.
    private async patchAction<TResult>(
        path: string,
        input: {
            ownerUserId: string;
            email: string;
            permissions: string[];
        },
        body: Record<string, unknown>,
        failureMessage: string,
    ): Promise<TResult> {
        const response = await fetch(`${this.productServiceUrl}${path}`, {
            method: 'PATCH',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-internal-service-token': this.internalServiceToken,
                'x-user-id': input.ownerUserId,
                'x-user-email': input.email,
                'x-user-permissions': input.permissions.join(','),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8_000),
        }).catch(() => null);
        if (response?.status === 409) {
            throw new ConflictException(
                'Dữ liệu vừa thay đổi. Hãy tải lại và tạo đề xuất mới.',
            );
        }
        if (!response?.ok) throw new BadGatewayException(failureMessage);
        return (await response.json()) as TResult;
    }
}
