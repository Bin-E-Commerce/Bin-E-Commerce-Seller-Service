import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  SellerApplicationReviewedEvent,
  SellerApplicationSubmittedEvent,
  SellerEvents,
} from "@common/kafka/events";
import { KafkaProducerService } from "../../../../../kafka/kafka-producer.service";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";

@Injectable()
export class SellerApplicationEventsService {
  constructor(private readonly kafkaProducer: KafkaProducerService) {}

  // Chuyển entity thành integration event có version để email, in-app notification và consumer tương lai dùng chung một sự kiện.
  // Data không mang CCCD, tài khoản ngân hàng hoặc ảnh giấy tờ để tránh rò rỉ PII qua Kafka.
  async publishSubmitted(application: SellerApplication): Promise<void> {
    const occurredAt =
      application.submittedAt?.toISOString() ?? new Date().toISOString();
    const event: SellerApplicationSubmittedEvent = {
      eventId: randomUUID(),
      eventName: SellerEvents.APPLICATION_SUBMITTED,
      eventVersion: 1,
      source: "seller-service",
      occurredAt,
      aggregateId: application.id,
      data: {
        applicationId: application.id,
        userId: application.userId,
        email: application.userEmail,
        shopName: application.shopName ?? "Shop của bạn",
        submittedAt: occurredAt,
        submissionRevision: application.submissionRevision ?? 1,
      },
    };

    await this.kafkaProducer.publish(
      SellerEvents.APPLICATION_SUBMITTED,
      event,
      application.id,
    );
  }

  // Phát fact hồ sơ bị từ chối để notification-service tự quyết định email và in-app delivery cho seller.
  async publishRejected(application: SellerApplication): Promise<void> {
    const occurredAt =
      application.reviewedAt?.toISOString() ?? new Date().toISOString();
    const event: SellerApplicationReviewedEvent = {
      eventId: randomUUID(),
      eventName: SellerEvents.APPLICATION_REJECTED,
      eventVersion: 1,
      source: "seller-service",
      occurredAt,
      aggregateId: application.id,
      data: {
        applicationId: application.id,
        userId: application.userId,
        email: application.userEmail,
        shopName: application.shopName ?? "Shop của bạn",
        reviewedAt: occurredAt,
        reviewNote: application.reviewNote,
        correctionTargets: application.correctionTargets ?? [],
        submissionRevision: application.submissionRevision ?? 1,
      },
    };

    await this.kafkaProducer.publish(
      SellerEvents.APPLICATION_REJECTED,
      event,
      application.id,
    );
  }

  // Phát fact hồ sơ đã được duyệt để Auth Service cấp role SELLER và Notification Service thông báo cho người dùng.
  async publishApproved(application: SellerApplication): Promise<void> {
    const occurredAt =
      application.reviewedAt?.toISOString() ?? new Date().toISOString();
    const event: SellerApplicationReviewedEvent = {
      eventId: randomUUID(),
      eventName: SellerEvents.APPLICATION_APPROVED,
      eventVersion: 1,
      source: "seller-service",
      occurredAt,
      aggregateId: application.id,
      data: {
        applicationId: application.id,
        userId: application.userId,
        email: application.userEmail,
        shopName: application.shopName ?? "Shop của bạn",
        reviewedAt: occurredAt,
        reviewNote: application.reviewNote,
        correctionTargets: [],
        submissionRevision: application.submissionRevision ?? 1,
      },
    };

    await this.kafkaProducer.publish(
      SellerEvents.APPLICATION_APPROVED,
      event,
      application.id,
    );
  }
}
