// Chuyển địa chỉ Seller từ UUID nội bộ sang mã master data GHN.

import { MigrationInterface, QueryRunner } from "typeorm";

export class UseGhnAddressCodes1788009000000 implements MigrationInterface {
  name = "UseGhnAddressCodes1788009000000";

  // Thay các cột địa chỉ cũ bằng mã và tên GHN; cột mới nullable để migration không làm hỏng dữ liệu legacy trước khi Seller cập nhật lại.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shop_pickup_addresses"
      DROP COLUMN IF EXISTS "province_id",
      DROP COLUMN IF EXISTS "district_id",
      DROP COLUMN IF EXISTS "ward_id",
      DROP COLUMN IF EXISTS "ghn_address_mapping",
      ADD COLUMN IF NOT EXISTS "ghn_province_id" integer NULL,
      ADD COLUMN IF NOT EXISTS "ghn_province_name" varchar(160) NULL,
      ADD COLUMN IF NOT EXISTS "ghn_district_id" integer NULL,
      ADD COLUMN IF NOT EXISTS "ghn_district_name" varchar(160) NULL,
      ADD COLUMN IF NOT EXISTS "ghn_ward_code" varchar(30) NULL,
      ADD COLUMN IF NOT EXISTS "ghn_ward_name" varchar(160) NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "seller_applications"
      DROP COLUMN IF EXISTS "pickup_province_id",
      DROP COLUMN IF EXISTS "pickup_ward_id",
      ADD COLUMN IF NOT EXISTS "pickup_ghn_province_id" integer NULL,
      ADD COLUMN IF NOT EXISTS "pickup_ghn_province_name" varchar(160) NULL,
      ADD COLUMN IF NOT EXISTS "pickup_ghn_district_id" integer NULL,
      ADD COLUMN IF NOT EXISTS "pickup_ghn_district_name" varchar(160) NULL,
      ADD COLUMN IF NOT EXISTS "pickup_ghn_ward_code" varchar(30) NULL,
      ADD COLUMN IF NOT EXISTS "pickup_ghn_ward_name" varchar(160) NULL
    `);
  }

  // Rollback chỉ khôi phục cấu trúc cột cũ, không thể khôi phục UUID đã bị loại khỏi dữ liệu.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shop_pickup_addresses"
      DROP COLUMN IF EXISTS "ghn_province_id",
      DROP COLUMN IF EXISTS "ghn_province_name",
      DROP COLUMN IF EXISTS "ghn_district_id",
      DROP COLUMN IF EXISTS "ghn_district_name",
      DROP COLUMN IF EXISTS "ghn_ward_code",
      DROP COLUMN IF EXISTS "ghn_ward_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "seller_applications"
      DROP COLUMN IF EXISTS "pickup_ghn_province_id",
      DROP COLUMN IF EXISTS "pickup_ghn_province_name",
      DROP COLUMN IF EXISTS "pickup_ghn_district_id",
      DROP COLUMN IF EXISTS "pickup_ghn_district_name",
      DROP COLUMN IF EXISTS "pickup_ghn_ward_code",
      DROP COLUMN IF EXISTS "pickup_ghn_ward_name"
    `);
  }
}
