import { MigrationInterface, QueryRunner } from 'typeorm';

// Bỏ cột metadata không còn được ứng dụng sử dụng khỏi bảng lịch sử tin nhắn Copilot.
export class RemoveSellerCopilotMessageMetadata1790000600000 implements MigrationInterface {
    name = 'RemoveSellerCopilotMessageMetadata1790000600000';

    // Xóa cột JSONB cũ; IF EXISTS giúp migration an toàn nếu môi trường đã được chỉnh schema thủ công.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_messages"
            DROP COLUMN IF EXISTS "metadata"
        `);
    }

    // Khôi phục schema khi rollback; dữ liệu JSONB đã bị xóa nên không thể khôi phục giá trị cũ.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_messages"
            ADD COLUMN IF NOT EXISTS "metadata" jsonb
        `);
    }
}
