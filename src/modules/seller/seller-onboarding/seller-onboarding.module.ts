import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SellerApplication } from "../../database/entities/seller-application.entity";
import { KafkaModule } from "../../kafka/kafka.module";
import { SellerApplicationsController } from "./controllers/seller-applications.controller";
import { SellerApplicationsService } from "./services/seller-applications.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([SellerApplication]),
    HttpModule,
    KafkaModule,
  ],
  controllers: [SellerApplicationsController],
  providers: [SellerApplicationsService],
})
export class SellerApplicationsModule {}
