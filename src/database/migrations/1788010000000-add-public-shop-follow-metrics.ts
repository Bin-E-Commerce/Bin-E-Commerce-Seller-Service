// Bổ sung read model public cho Shop và quan hệ follow.
// Migration có IF EXISTS/IF NOT EXISTS để an toàn với database local đã được tạo từ schema cũ.

import { MigrationInterface, QueryRunner } from "typeorm";

// Migration mở rộng schema Seller cho trang shop public và số liệu follow.
export class AddPublicShopFollowMetrics1788010000000 implements MigrationInterface {
  name = "AddPublicShopFollowMetrics1788010000000";

  // Tạo counter và unique relation để thao tác follow idempotent, chống duplicate ở database layer.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      ALTER TABLE "shops"
        ADD COLUMN IF NOT EXISTS "follower_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "following_count" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shop_follows" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shop_id" uuid NOT NULL,
        "follower_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shop_follows_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_shop_follows_shop_follower" UNIQUE ("shop_id", "follower_user_id"),
        CONSTRAINT "FK_shop_follows_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_shop_follows_follower_created" ON "shop_follows" ("follower_user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_shop_follows_shop_created" ON "shop_follows" ("shop_id", "created_at")`,
    );
  }

  // Xóa phần schema do migration sở hữu; dữ liệu shop cốt lõi vẫn được giữ nguyên.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shop_follows"`);
    await queryRunner.query(
      `ALTER TABLE "shops" DROP COLUMN IF EXISTS "follower_count", DROP COLUMN IF EXISTS "following_count"`,
    );
  }
}
