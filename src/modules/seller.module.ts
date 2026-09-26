import { Module } from '@nestjs/common';
import { SellerOnboardingModule } from '@/modules/seller-onboarding/seller-onboarding.module';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';

@Module({
    imports: [SellerOnboardingModule, ShopProfileModule],
})
export class SellerModule {}
