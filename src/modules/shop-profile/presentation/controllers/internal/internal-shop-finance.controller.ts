// Endpoint nội bộ cho Order Service đồng bộ trạng thái shop theo công nợ đã ghi trong ví.
import {
    Body,
    BadRequestException,
    Controller,
    Headers,
    Param,
    ParseUUIDPipe,
    Get,
    Put,
    Query,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { ShopFinanceLockService } from '@/modules/shop-profile/application/services/finance/shop-finance-lock.service';
import { SetShopFinanceLockDto } from '@/modules/shop-profile/presentation/dto/finance/set-shop-finance-lock.dto';

@Controller('internal/seller/shops')
export class InternalShopFinanceController {
    constructor(
        private readonly service: ShopFinanceLockService,
        private readonly config: ConfigService,
    ) {}

    // Chỉ shared token nội bộ được phép khóa storefront; shopId phải là UUID và cờ khóa phải là boolean.
    @Put(':shopId/finance-lock')
    async setFinanceLock(
        @Param('shopId', new ParseUUIDPipe()) shopId: string,
        @Headers('x-internal-service-token') token: string,
        @Body() dto: SetShopFinanceLockDto,
    ): Promise<{ success: true }> {
        this.assertInternalToken(token);
        await this.service.setFinanceLock(shopId, dto.locked);
        return { success: true };
    }

    // Product Service dùng readiness theo shop snapshot để không nhận thêm đơn từ shop bị khóa công nợ.
    @Get('sales-readiness')
    async getSalesReadiness(
        @Headers('x-internal-service-token') token: string,
        @Query('shopIds') shopIdsValue: string,
    ): Promise<{ inactiveShopIds: string[] }> {
        this.assertInternalToken(token);
        const shopIds = [...new Set((shopIdsValue ?? '').split(','))];
        // Giới hạn lô và xác thực UUID trước DB để query param không tạo truy vấn không giới hạn.
        if (
            shopIds.length === 0 ||
            shopIds.length > 50 ||
            shopIds.some((shopId) => !isUUID(shopId))
        )
            throw new BadRequestException(
                'Danh sách shop cần kiểm tra không hợp lệ.',
            );
        return {
            inactiveShopIds: await this.service.findInactiveShopIds(shopIds),
        };
    }

    // Không cho request thiếu secret dùng endpoint vận hành không được proxy ra browser.
    private assertInternalToken(token: string): void {
        const expected = this.config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        if (!expected || token !== expected)
            throw new UnauthorizedException('Invalid internal service token.');
    }
}
