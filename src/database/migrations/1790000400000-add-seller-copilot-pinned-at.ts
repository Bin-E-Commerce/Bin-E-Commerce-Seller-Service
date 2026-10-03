import { MigrationInterface, QueryRunner } from 'typeorm';

// Lưu riêng thời điểm ghim để thứ tự nhóm pinned không bị ảnh hưởng bởi các lần cập nhật nội dung chat.
export class AddSellerCopilotPinnedAt1790000400000 implements MigrationInterface {
    name = 'AddSellerCopilotPinnedAt1790000400000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz NULL
        `);
        await queryRunner.query(`
            UPDATE "seller_copilot_conversations"
            SET "pinned_at" = "updated_at"
            WHERE "is_pinned" = true AND "pinned_at" IS NULL
        `);
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_seller_copilot_conversations_scope_pinned"',
        );
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_conversations_scope_pinned_at"
            ON "seller_copilot_conversations"
            ("owner_user_id", "shop_id", "is_pinned", "pinned_at", "updated_at", "id")
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_seller_copilot_conversations_scope_pinned_at"',
        );
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_conversations_scope_pinned"
            ON "seller_copilot_conversations"
            ("owner_user_id", "shop_id", "is_pinned", "updated_at")
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            DROP COLUMN IF EXISTS "pinned_at"
        `);
    }
}
