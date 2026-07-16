import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthModule } from "./modules/health/health.module";
import { SellerModule } from "./modules/seller/seller.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("POSTGRES_HOST", "localhost"),
        port: config.get<number>("POSTGRES_PORT", 5432),
        username: config.get<string>("POSTGRES_USER"),
        password: config.get<string>("POSTGRES_PASSWORD"),
        database: config.get<string>("POSTGRES_DB"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        synchronize: config.get<string>("NODE_ENV") !== "production",
        ssl:
          config.get<string>("NODE_ENV") === "production"
            ? { rejectUnauthorized: false }
            : false,
        logging: config.get<string>("TYPEORM_LOGGING", "false") === "true",
      }),
    }),
    HealthModule,
    SellerModule,
  ],
})
export class AppModule {}
