import { Module } from '@nestjs/common';
import { SellerOnboardingModule } from '@/modules/seller-onboarding/seller-onboarding.module';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';
import { SellerDashboardModule } from '@/modules/seller-dashboard/seller-dashboard.module';
import { SellerCopilotModule } from '@/modules/seller-copilot/seller-copilot.module';
import { SellerKnowledgeModule } from '@/modules/seller-knowledge/seller-knowledge.module';

@Module({
    imports: [
        SellerOnboardingModule,
        ShopProfileModule,
        SellerDashboardModule,
        SellerKnowledgeModule,
        SellerCopilotModule,
    ],
})
export class SellerModule {}
