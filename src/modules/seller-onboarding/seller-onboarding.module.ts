import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaModule } from '@/kafka/kafka.module';
import { SellerApplication } from '@/database/seller-onboarding/entities/seller-application.entity';
import { ShopComplianceProfile } from '@/database/shop-profile/entities/shop-compliance-profile.entity';
import { Shop } from '@/database/shop-profile/entities/shop.entity';
import { SellerApplicationAuthService } from '@/modules/seller-onboarding/application/services/seller-application-auth.service';
import { SellerApplicationEventsService } from '@/modules/seller-onboarding/application/services/seller-application-events.service';
import { SellerApplicationMapper } from '@/modules/seller-onboarding/application/services/seller-application.mapper';
import { SellerApplicationsService } from '@/modules/seller-onboarding/application/services/seller-applications.service';
import { SellerApplicationValidatorService } from '@/modules/seller-onboarding/application/services/seller-application-validator.service';
import { SellerApplicationCorrectionService } from '@/modules/seller-onboarding/application/services/seller-application-correction.service';
import { SellerApplicationsController } from '@/modules/seller-onboarding/presentation/controllers/seller-applications.controller';
import { SellerApplicationActivityService } from '@/modules/seller-onboarding/application/services/seller-application-activity.service';
import { SellerApplicationActivityRepository } from '@/modules/seller-onboarding/infrastructure/repositories/analytics/seller-application-activity.repository';
import { SELLER_APPLICATION_ACTIVITY_REPOSITORY } from '@/modules/seller-onboarding/application/contracts/seller-application-activity.repository';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            SellerApplication,
            Shop,
            ShopComplianceProfile,
        ]),
        // Cấu hình HTTP ngay tại feature sở hữu integration để request Catalog có timeout và không theo redirect lạ.
        HttpModule.register({ timeout: 5000, maxRedirects: 0 }),
        KafkaModule,
    ],
    controllers: [SellerApplicationsController],
    providers: [
        SellerApplicationsService,
        SellerApplicationActivityService,
        SellerApplicationActivityRepository,
        {
            provide: SELLER_APPLICATION_ACTIVITY_REPOSITORY,
            useExisting: SellerApplicationActivityRepository,
        },
        SellerApplicationAuthService,
        SellerApplicationEventsService,
        SellerApplicationMapper,
        SellerApplicationValidatorService,
        SellerApplicationCorrectionService,
    ],
})
export class SellerOnboardingModule {}
