// File này khởi động Seller Service, cấu hình HTTP boundary và telemetry dùng chung.
// File không chứa workflow duyệt seller; application/presentation layer sở hữu workflow đó.

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { buildHelmetOptions } from "./common/config/helmet.config";
import { setupHttpObservability } from "../../../packages/common/observability/http-observability";

// Khởi động Seller Service, nơi xử lý hồ sơ đăng ký người bán trước khi admin duyệt.
// Khởi động seller boundary và đăng ký middleware cross-cutting trước khi nhận traffic.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  const config = app.get(ConfigService);
  const isDev = config.get<string>("NODE_ENV") !== "production";
  const port = config.get<number>("PORT", 3007);

  app.use(helmet(buildHelmetOptions(isDev)));
  app.setGlobalPrefix("api");
  // Đăng ký metrics RED và request ID trước khi service bắt đầu nhận traffic.
  setupHttpObservability(app, "seller-service");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors({ origin: false });

  if (isDev) {
    const documentConfig = new DocumentBuilder()
      .setTitle("Seller Service")
      .setDescription("Seller onboarding and seller application APIs")
      .setVersion("1.0")
      .build();
    SwaggerModule.setup(
      "docs",
      app,
      SwaggerModule.createDocument(app, documentConfig),
    );
  }

  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`[seller-service] Running on port ${port}`);
}

void bootstrap();
