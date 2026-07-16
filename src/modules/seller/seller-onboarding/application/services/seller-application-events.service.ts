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

  // Chuyển entity nội bộ thành event contract dùng chung rồi phát thông báo hồ sơ đã gửi thành công.
  // Payload không mang CCCD, tài khoản ngân hàng hoặc giấy tờ để tránh rò rỉ PII qua Kafka.
  async publishSubmittedEmail(application: SellerApplication): Promise<void> {
    const payload: SellerApplicationSubmittedPayload = {
      applicationId: application.id,
      userId: application.userId,
      email: application.userEmail,
      shopName: application.shopName ?? "Shop của bạn",
      // Nhánh fallback chỉ bảo vệ dữ liệu cũ; luồng submit hiện tại luôn gán submittedAt trước khi publish.
      submittedAt:
        application.submittedAt?.toISOString() ?? new Date().toISOString(),
    };

    // Topic lấy từ shared package để producer và notification consumer không lệch tên event.
    await this.kafkaProducer.publish(SellerEvents.APPLICATION_SUBMITTED, payload);
  }
}
