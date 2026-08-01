import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SellerApplication } from "../../../database/entities/seller-application.entity";
import { Shop } from "../../../database/entities/shop.entity";
import { ShopProfileAccessService } from "./application/services/shop-profile-access.service";
import { ShopProfileService } from "./application/services/shop-profile.service";
import { ShopProfileController } from "./presentation/controllers/shop-profile.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Shop, SellerApplication])],
  controllers: [ShopProfileController],
  providers: [ShopProfileService, ShopProfileAccessService],
})
export class ShopProfileModule {}
