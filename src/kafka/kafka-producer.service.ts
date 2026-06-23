import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Producer } from "kafkajs";

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;

  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .get<string>("KAFKA_BROKERS", "localhost:29092")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean);

    const kafka = new Kafka({
      clientId: this.config.get<string>("KAFKA_CLIENT_ID", "seller-service"),
      brokers,
      retry: { retries: 3 },
    });

    this.producer = kafka.producer();
  }

  // Kết nối Kafka khi service khởi động; lỗi Kafka không được chặn luồng đăng ký seller chính.
  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log("Kafka producer connected");
    } catch (err) {
      this.logger.warn(
        `Kafka producer connect failed (non-fatal): ${String(err)}`,
      );
    }
  }

  // Đóng producer khi Nest shutdown để tránh giữ connection treo trong dev watch mode.
  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect().catch(() => void 0);
  }

  // Publish event dạng JSON để các service khác có thể consume mà không cần biết entity nội bộ.
  async publish(topic: string, payload: unknown): Promise<void> {
    try {
      await this.producer.send({
        topic,
        messages: [{ value: JSON.stringify(payload) }],
      });
    } catch (err) {
      this.logger.error(
        `Failed to publish to topic "${topic}": ${String(err)}`,
      );
    }
  }
}
