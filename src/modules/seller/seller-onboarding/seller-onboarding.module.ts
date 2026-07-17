import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KafkaModule } from "../../../kafka/kafka.module";
import { SellerApplication } from "../../../database/entities/seller-application.entity";
import { SellerApplicationAuthService } from "./application/services/seller-application-auth.service";
import { SellerApplicationEventsService } from "./application/services/seller-application-events.service";
import { SellerApplicationMapper } from "./application/services/seller-application.mapper";
import { SellerApplicationsService } from "./application/services/seller-applications.service";
import { SellerApplicationValidatorService } from "./application/services/seller-application-validator.service";
import { SellerApplicationCorrectionService } from "./application/services/seller-application-correction.service";
import { SellerApplicationsController } from "./presentation/controllers/seller-applications.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([SellerApplication]),
    // Cấu hình HTTP ngay tại feature sở hữu integration để mọi request catalog/location đều có timeout và không theo redirect lạ.
    HttpModule.register({ timeout: 5000, maxRedirects: 0 }),
    KafkaModule,
  ],
  controllers: [SellerApplicationsController],
  providers: [
    SellerApplicationsService,
    SellerApplicationAuthService,
    SellerApplicationEventsService,
    SellerApplicationMapper,
    SellerApplicationValidatorService,
    SellerApplicationCorrectionService,
  ],
})
export class SellerOnboardingModule {}
