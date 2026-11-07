import {
    Controller,
    Get,
    Headers,
    Param,
    ParseUUIDPipe,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ShopOwnershipService } from '@/modules/shop-profile/application/services/shop-ownership.service';

// Contract nội bộ tối thiểu để Auth Service lấy logo shop khi tạo viewer response.
@Controller('internal/seller/users')
export class InternalShopProfileController {
    constructor(
        private readonly shopOwnershipService: ShopOwnershipService,
        private readonly config: ConfigService,
    ) {}

    // Trả logo theo ownerUserId; không mở toàn bộ dữ liệu shop ra ngoài contract cần thiết.
    @Get(':ownerUserId/shop-logo')
    async getShopLogo(
        @Param('ownerUserId', new ParseUUIDPipe()) ownerUserId: string,
        @Headers('x-internal-service-token') token: string,
    ): Promise<{ logoUrl: string | null }> {
        this.assertInternalToken(token);

        const shop = await this.shopOwnershipService.findOwnedShop(ownerUserId);
        return { logoUrl: shop?.logoUrl?.trim() || null };
    }

    // Bảo vệ route bằng shared secret vì Auth Service chỉ cần đọc dữ liệu nội bộ giữa các service.
    private assertInternalToken(token: string): void {
        const expected = this.config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        if (!expected || token !== expected) {
            throw new UnauthorizedException('Invalid internal service token.');
        }
    }
}
