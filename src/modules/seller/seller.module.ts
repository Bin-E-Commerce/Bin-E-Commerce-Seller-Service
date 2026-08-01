import { Module } from "@nestjs/common";
import { SellerOnboardingModule } from "./seller-onboarding/seller-onboarding.module";
import { ShopProfileModule } from "./shop-profile/shop-profile.module";

@Module({
  imports: [SellerOnboardingModule, ShopProfileModule],
})
export class SellerModule {}
