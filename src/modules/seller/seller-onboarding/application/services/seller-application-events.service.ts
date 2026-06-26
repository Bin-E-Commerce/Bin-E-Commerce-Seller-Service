import { Injectable } from "@nestjs/common";
import {
  SellerApplicationSubmittedPayload,
  SellerEvents,
} from "@common/kafka/events";
import { KafkaProducerService } from "../../../../../kafka/kafka-producer.service";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";

@Injectable()
export class SellerApplicationEventsService {
  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  // Publish event cho notification-service gửi email xác nhận hồ sơ đang chờ duyệt.
  async publishSubmittedEmail(application: SellerApplication): Promise<void> {
    const payload: SellerApplicationSubmittedPayload = {
      applicationId: application.id,
      userId: application.userId,
      email: application.userEmail,
      shopName: application.shopName ?? "Shop của bạn",
      submittedAt: application.submittedAt?.toISOString() ?? new Date().toISOString(),
    };

    await this.kafkaProducer.publish(SellerEvents.APPLICATION_SUBMITTED, payload);
  }
}
