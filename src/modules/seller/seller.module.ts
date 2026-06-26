import { Module } from "@nestjs/common";
import { SellerOnboardingModule } from "./seller-onboarding/seller-onboarding.module";

@Module({
  imports: [SellerOnboardingModule],
})
export class SellerModule {}
