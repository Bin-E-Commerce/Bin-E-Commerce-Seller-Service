import { Module } from '@nestjs/common';
import { SellerOnboardingModule } from '@/modules/seller-onboarding/seller-onboarding.module';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';
import { SellerDashboardModule } from '@/modules/seller-dashboard/seller-dashboard.module';

@Module({
    imports: [SellerOnboardingModule, ShopProfileModule, SellerDashboardModule],
})
export class SellerModule {}
