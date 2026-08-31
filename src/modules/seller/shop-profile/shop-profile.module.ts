import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ShopComplianceProfile } from "../../../database/entities/shop-compliance-profile.entity";
import { ShopProfileChangeRequest } from "../../../database/entities/shop-profile-change-request.entity";
import { Shop } from "../../../database/entities/shop.entity";
import { SellerApplication } from "../../../database/entities/seller-application.entity";
import { ShopPickupAddress } from "../../../database/entities/shop-pickup-address.entity";
import { ShopShippingSettings } from "../../../database/entities/shop-shipping-settings.entity";
import { KafkaModule } from "../../../kafka/kafka.module";
import { ShopComplianceProfileService } from "./application/services/shop-compliance-profile.service";
import { ShopOwnershipService } from "./application/services/shop-ownership.service";
import { ShopProfileAccessService } from "./application/services/shop-profile-access.service";
import { ShopProfileChangeRequestService } from "./application/services/shop-profile-change-request.service";
import { ShopProfileChangeRequestEventsService } from "./application/services/shop-profile-change-request-events.service";
import { ShopProfileService } from "./application/services/shop-profile.service";
import { ShopProfileChangeRequestController } from "./presentation/controllers/shop-profile-change-request.controller";
import { ShopProfileController } from "./presentation/controllers/shop-profile.controller";
import { ShopShippingSettingsController } from "./presentation/controllers/shop-shipping-settings.controller";
import { ShopShippingSettingsService } from "./application/services/shop-shipping-settings.service";
import { InternalShopShippingController } from "./presentation/controllers/internal-shop-shipping.controller";
import { ProductCatalogClient } from "./application/clients/product-catalog.client";

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
    ]),
  ],
  controllers: [ShopProfileController, ShopProfileChangeRequestController, ShopShippingSettingsController, InternalShopShippingController],
  providers: [
    ShopProfileService,
    ShopProfileAccessService,
    ShopOwnershipService,
    ShopComplianceProfileService,
    ShopProfileChangeRequestEventsService,
    ShopProfileChangeRequestService,
    ShopShippingSettingsService,
    ProductCatalogClient,
  ],
})
export class ShopProfileModule {}
