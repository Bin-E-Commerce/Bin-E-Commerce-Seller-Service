import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  SellerEvents,
  SellerShopProfileChangeRequestedEvent,
  SellerShopProfileChangeReviewedEvent,
  SellerShopProfileChangeSection,
} from "@common/kafka/events";
import { ShopProfileChangeRequest } from "../../../../../database/entities/shop-profile-change-request.entity";
import { KafkaProducerService } from "../../../../../kafka/kafka-producer.service";

@Injectable()
export class ShopProfileChangeRequestEventsService {
  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  // Phát fact sau khi transaction đã commit để Notification Service lưu thông báo và đẩy realtime tới nhóm admin có quyền đọc.
  // Payload chỉ mang dữ liệu điều hướng; thông tin thuế, ngân hàng và giấy tờ định danh không được đưa lên Kafka.
  async publishRequested(request: ShopProfileChangeRequest): Promise<void> {
    const occurredAt = request.submittedAt.toISOString();
    const event: SellerShopProfileChangeRequestedEvent = {
      eventId: randomUUID(),
      eventName: SellerEvents.SHOP_PROFILE_CHANGE_REQUESTED,
      eventVersion: 1,
      source: "seller-service",
      occurredAt,
      aggregateId: request.id,
      data: {
        requestId: request.id,
        shopId: request.shopId,
        shopName: request.shop.name,
        requesterUserId: request.requesterUserId,
        sections: request.sections as SellerShopProfileChangeSection[],
        submittedAt: occurredAt,
      },
    };

    await this.kafkaProducer.publish(
      SellerEvents.SHOP_PROFILE_CHANGE_REQUESTED,
      event,
      request.shopId,
    );
  }

  // Phát kết quả duyệt tới đúng chủ shop; consumer dùng requesterUserId làm audience nên seller khác không nhận được thông báo này.
  async publishApproved(request: ShopProfileChangeRequest): Promise<void> {
    await this.publishReviewed(
      request,
      SellerEvents.SHOP_PROFILE_CHANGE_APPROVED,
    );
  }

  // Phát kết quả từ chối cùng ghi chú để chủ shop biết yêu cầu cần xem lại mà không phải tự làm mới trang liên tục.
  async publishRejected(request: ShopProfileChangeRequest): Promise<void> {
    await this.publishReviewed(
      request,
      SellerEvents.SHOP_PROFILE_CHANGE_REJECTED,
    );
  }

  // Chuẩn hóa envelope dùng chung cho hai quyết định review và giữ payload không chứa dữ liệu compliance nhạy cảm.
  private async publishReviewed(
    request: ShopProfileChangeRequest,
    eventName:
      | typeof SellerEvents.SHOP_PROFILE_CHANGE_APPROVED
      | typeof SellerEvents.SHOP_PROFILE_CHANGE_REJECTED,
  ): Promise<void> {
    const reviewedAt = (request.reviewedAt ?? new Date()).toISOString();
    const event: SellerShopProfileChangeReviewedEvent = {
      eventId: randomUUID(),
      eventName,
      eventVersion: 1,
      source: "seller-service",
      occurredAt: reviewedAt,
      aggregateId: request.id,
      data: {
        requestId: request.id,
        shopId: request.shopId,
        shopName: request.shop.name,
        requesterUserId: request.requesterUserId,
        sections: request.sections as SellerShopProfileChangeSection[],
        reviewedAt,
        reviewNote: request.reviewNote,
      },
    };

    await this.kafkaProducer.publish(eventName, event, request.shopId);
  }
}
