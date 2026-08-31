// Thêm mapping GHN riêng cho pickup address mà không thay đổi địa chỉ hành chính canonical.

import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGhnAddressMapping1788008000000 implements MigrationInterface {
  name = "AddGhnAddressMapping1788008000000";

  // Migration có guard để chạy được trên database seller cũ và database mới.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shop_pickup_addresses"
      ADD COLUMN IF NOT EXISTS "ghn_address_mapping" jsonb NULL
    `);
  }

  // Xóa metadata mapping nhưng không xóa địa chỉ pickup của seller.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shop_pickup_addresses"
      DROP COLUMN IF EXISTS "ghn_address_mapping"
    `);
  }
}
