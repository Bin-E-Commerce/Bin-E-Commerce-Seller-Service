import { MigrationInterface, QueryRunner } from 'typeorm';

// Bổ sung trạng thái ghim cho conversation; mặc định false để dữ liệu history cũ không bị thay đổi hành vi.
export class AddSellerCopilotPinned1790000300000 implements MigrationInterface {
    name = 'AddSellerCopilotPinned1790000300000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ADD COLUMN IF NOT EXISTS "is_pinned" boolean NOT NULL DEFAULT false
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_conversations_scope_pinned"
            ON "seller_copilot_conversations" ("owner_user_id", "shop_id", "is_pinned", "updated_at")
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_seller_copilot_conversations_scope_pinned"',
        );
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            DROP COLUMN IF EXISTS "is_pinned"
        `);
    }
}
