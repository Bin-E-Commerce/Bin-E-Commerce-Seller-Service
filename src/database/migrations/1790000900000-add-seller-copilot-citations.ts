import { MigrationInterface, QueryRunner } from 'typeorm';

// Bổ sung metadata citation để lịch sử chat render được nguồn tài liệu sau khi tải lại conversation.
export class AddSellerCopilotCitations1790000900000 implements MigrationInterface {
    name = 'AddSellerCopilotCitations1790000900000';

    // Cột nullable giữ tương thích toàn bộ message cũ và không yêu cầu backfill nội dung hội thoại.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_messages"
            ADD COLUMN IF NOT EXISTS "metadata" jsonb
        `);
    }

    // Rollback loại metadata citation mới, nhưng không đụng content hay lịch sử message.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_messages"
            DROP COLUMN IF EXISTS "metadata"
        `);
    }
}
