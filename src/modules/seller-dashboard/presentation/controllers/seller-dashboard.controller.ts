// HTTP boundary của dashboard seller; ownership được resolve từ header do API Gateway inject.

import { Controller, Get, Headers, Query } from '@nestjs/common';
import { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import { SellerDashboardQueryDto } from '@/modules/seller-dashboard/presentation/dto/seller-dashboard-query.dto';
import type { SellerDashboardSnapshot } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';

@Controller('seller/dashboard')
export class SellerDashboardController {
    constructor(private readonly dashboard: SellerDashboardService) {}

    // Không nhận shopId từ query; userId tin cậy từ Gateway là nguồn scope duy nhất.
    @Get('overview')
    getOverview(
        @Headers('x-user-id') ownerUserId: string,
        @Query() query: SellerDashboardQueryDto,
    ): Promise<SellerDashboardSnapshot> {
        return this.dashboard.getOverview(ownerUserId, query.range);
    }
}
