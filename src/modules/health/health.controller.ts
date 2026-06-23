import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Controller("health")
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  // Trả trạng thái sống cơ bản cho gateway, Prometheus hoặc Docker healthcheck.
  @Get()
  check() {
    return {
      service: "seller-service",
      status: "ok",
      version: this.config.get<string>("APP_VERSION", "1.0.0"),
      timestamp: new Date().toISOString(),
    };
  }
}
