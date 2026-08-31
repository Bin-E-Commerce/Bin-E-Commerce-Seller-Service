// Xóa cột provider cũ khỏi cấu hình giao nhận vì platform chỉ dùng GHN Test.

import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveShippingProvider1788007000000 implements MigrationInterface {
  name = "RemoveShippingProvider1788007000000";

  // Migration có guard theo table để chạy an toàn trên cả database legacy và database mới.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('shop_shipping_settings') IS NOT NULL THEN
          ALTER TABLE "shop_shipping_settings" DROP COLUMN IF EXISTS "provider";
        END IF;
      END $$;
    `);
  }

  // Không khôi phục provider đã loại bỏ; database sau rollback vẫn giữ mô hình một provider của phase hiện tại.
  async down(): Promise<void> {
    return;
  }
}
