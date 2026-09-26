// Wiring module cho read-only Seller Dashboard.

import { Module } from '@nestjs/common';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';
import { OrderDashboardClient } from '@/modules/seller-dashboard/application/clients/order-dashboard.client';
import { ProductDashboardClient } from '@/modules/seller-dashboard/application/clients/product-dashboard.client';
import { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import { SellerDashboardController } from '@/modules/seller-dashboard/presentation/controllers/seller-dashboard.controller';

@Module({
    imports: [ShopProfileModule],
    controllers: [SellerDashboardController],
    providers: [
        OrderDashboardClient,
        ProductDashboardClient,
        SellerDashboardService,
    ],
})
export class SellerDashboardModule {}
