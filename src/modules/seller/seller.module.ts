import { Module } from "@nestjs/common";
import { SellerAccountModule } from "./seller-account/seller-account.module";
import { SellerAnalyticsModule } from "./seller-analytics/seller-analytics.module";
import { SellerCatalogModule } from "./catalog/catalog.module";
import { SellerFinanceModule } from "./seller-finance/seller-finance.module";
import { SellerInventoryModule } from "./inventory/inventory.module";
import { SellerOnboardingModule } from "./seller-onboarding/seller-onboarding.module";
import { SellerOrderModule } from "./seller-order/seller-order.module";
import { SellerPromotionModule } from "./promotion/promotion.module";
import { SellerStaffModule } from "./seller-staff/seller-staff.module";
import { ShopManagementModule } from "./shop-management/shop-management.module";

@Module({
  imports: [
    SellerOnboardingModule,
    SellerAccountModule,
    ShopManagementModule,
    SellerCatalogModule,
    SellerInventoryModule,
    SellerPromotionModule,
    SellerStaffModule,
    SellerOrderModule,
    SellerFinanceModule,
    SellerAnalyticsModule,
  ],
})
export class SellerModule {}
