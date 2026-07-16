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

  // Khởi tạo một producer dùng chung cho vòng đời process; broker list được chuẩn hóa từ biến môi trường phân cách bằng dấu phẩy.
  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .get<string>("KAFKA_BROKERS", "localhost:29092")
      .split(",")
      .map((broker) => broker.trim())
      .filter(Boolean);

    // Retry ở client xử lý lỗi mạng ngắn hạn; lỗi sau cùng vẫn được publish() ghi log để request chính không bị crash.
    const kafka = new Kafka({
      clientId: this.config.get<string>("KAFKA_CLIENT_ID", "seller-service"),
      brokers,
      retry: { retries: 3 },
    });

    this.producer = kafka.producer();
  }

  // Kết nối Kafka khi service khởi động; lỗi Kafka không chặn HTTP server để môi trường local vẫn lưu được hồ sơ.
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

  // Publish JSON contract thay vì entity để consumer không phụ thuộc schema bảng của seller-service.
  // Hàm hiện dùng chiến lược best-effort: lỗi được log nhưng không rollback nghiệp vụ đã lưu trong DB.
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
