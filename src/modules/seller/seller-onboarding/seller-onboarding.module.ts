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
import { SellerApplicationsController } from "./presentation/controllers/seller-applications.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([SellerApplication]),
    HttpModule,
    KafkaModule,
  ],
  controllers: [SellerApplicationsController],
  providers: [
    SellerApplicationsService,
    SellerApplicationAuthService,
    SellerApplicationEventsService,
    SellerApplicationMapper,
    SellerApplicationValidatorService,
  ],
})
export class SellerOnboardingModule {}
