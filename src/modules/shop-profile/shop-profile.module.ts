// Module này đăng ký use case hồ sơ Seller, public shop và các contract nội bộ liên quan đến vận chuyển.
// Business logic được giữ trong application services; module chỉ chịu trách nhiệm wiring dependency.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShopComplianceProfile } from '@/database/shop-profile/entities/shop-compliance-profile.entity';
import { ShopProfileChangeRequest } from '@/database/shop-profile/entities/shop-profile-change-request.entity';
import { Shop } from '@/database/shop-profile/entities/shop.entity';
import { SellerApplication } from '@/database/seller-onboarding/entities/seller-application.entity';
import { ShopPickupAddress } from '@/database/shop-profile/entities/shop-pickup-address.entity';
import { ShopShippingSettings } from '@/database/shop-profile/entities/shop-shipping-settings.entity';
import { KafkaModule } from '@/kafka/kafka.module';
import { ShopComplianceProfileService } from '@/modules/shop-profile/application/services/shop-compliance-profile.service';
import { ShopOwnershipService } from '@/modules/shop-profile/application/services/shop-ownership.service';
import { ShopProfileAccessService } from '@/modules/shop-profile/application/services/shop-profile-access.service';
import { ShopProfileChangeRequestService } from '@/modules/shop-profile/application/services/shop-profile-change-request.service';
import { ShopProfileChangeRequestEventsService } from '@/modules/shop-profile/application/services/shop-profile-change-request-events.service';
import { ShopProfileService } from '@/modules/shop-profile/application/services/shop-profile.service';
import { ShopProfileChangeRequestController } from '@/modules/shop-profile/presentation/controllers/shop-profile-change-request.controller';
import { ShopProfileController } from '@/modules/shop-profile/presentation/controllers/shop-profile.controller';
import { ShopShippingSettingsController } from '@/modules/shop-profile/presentation/controllers/shop-shipping-settings.controller';
import { ShopShippingSettingsService } from '@/modules/shop-profile/application/services/shop-shipping-settings.service';
import { InternalShopShippingController } from '@/modules/shop-profile/presentation/controllers/internal-shop-shipping.controller';
import { InternalShopProfileController } from '@/modules/shop-profile/presentation/controllers/internal-shop-profile.controller';
import { ProductCatalogClient } from '@/modules/shop-profile/application/clients/product-catalog.client';
import { AuthUserClient } from '@/modules/shop-profile/application/clients/auth-user.client';
import { PublicShopService } from '@/modules/shop-profile/application/services/public-shop.service';
import { PublicShopController } from '@/modules/shop-profile/presentation/controllers/public-shop.controller';
import { ShopFollow } from '@/database/shop-profile/entities/shop-follow.entity';

@Module({
    imports: [
        KafkaModule,
        TypeOrmModule.forFeature([
            Shop,
            SellerApplication,
            ShopComplianceProfile,
            ShopProfileChangeRequest,
            ShopPickupAddress,
            ShopShippingSettings,
            ShopFollow,
        ]),
    ],
    controllers: [
        ShopProfileController,
        ShopProfileChangeRequestController,
        ShopShippingSettingsController,
        InternalShopShippingController,
        InternalShopProfileController,
        PublicShopController,
    ],
    providers: [
        ShopProfileService,
        ShopProfileAccessService,
        ShopOwnershipService,
        ShopComplianceProfileService,
        ShopProfileChangeRequestEventsService,
        ShopProfileChangeRequestService,
        ShopShippingSettingsService,
        ProductCatalogClient,
        AuthUserClient,
        PublicShopService,
    ],
    exports: [ShopOwnershipService],
})
export class ShopProfileModule {}
