// Access service của Seller Copilot: resolve trusted owner thành shop ACTIVE trước mọi read/write.
// Service không nhận shopId từ browser hoặc AI, nên các use case phía trên dùng chung một tenant boundary.
import {
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ShopStatus } from '@/database/shop-profile/enums/shop-status.enum';
import { ShopOwnershipService } from '@/modules/shop-profile/application/services/shop-ownership.service';

export type SellerCopilotActiveShop = {
    id: string;
    ownerUserId: string;
    name: string;
    slug: string;
    description: string | null;
    mainCategoryId: string;
    businessModel: string;
    status: ShopStatus;
    contactEmail: string;
    contactPhone: string;
};

@Injectable()
export class SellerCopilotAccessService {
    constructor(private readonly ownership: ShopOwnershipService) {}

    // Xác thực identity trusted, kiểm tra shop tồn tại và chỉ cho phép shop ACTIVE đi vào pipeline.
    // Thiếu user, thiếu shop hoặc shop chưa active trả lỗi khác nhau để HTTP boundary giữ đúng semantics.
    async resolveActiveShop(
        ownerUserId: string | undefined,
    ): Promise<SellerCopilotActiveShop> {
        // Nếu thiếu user context thì không thể xác thực shop; trả lỗi Unauthorized để Nest/Gateway trả HTTP 401.
        if (!ownerUserId?.trim()) {
            throw new UnauthorizedException('Thiếu user context.');
        }

        const shop = await this.ownership.findOwnedShop(ownerUserId);

        // Nếu shop không tồn tại thì trả lỗi NotFound để Nest/Gateway trả HTTP 404; không reveal thông tin shop.
        if (!shop) {
            throw new NotFoundException('Shop chưa được kích hoạt.');
        }
        // Nếu shop chưa active thì trả lỗi Forbidden để Nest/Gateway trả HTTP 403; không reveal thông tin shop.
        if (shop.status !== ShopStatus.ACTIVE) {
            throw new ForbiddenException('Shop chưa ở trạng thái hoạt động.');
        }

        return {
            id: shop.id,
            ownerUserId: shop.ownerUserId,
            name: shop.name,
            slug: shop.slug,
            description: shop.description,
            mainCategoryId: shop.mainCategoryId,
            businessModel: shop.businessModel,
            status: shop.status,
            contactEmail: shop.contactEmail,
            contactPhone: shop.contactPhone,
        };
    }
}
