import { MigrationInterface, QueryRunner } from 'typeorm';

// Mở rộng title thêm 4 ký tự để tên tự sinh hiển thị đầy đủ hơn mà vẫn giữ giới hạn ngắn cho sidebar.
export class ExpandSellerCopilotConversationTitle1790000500000 implements MigrationInterface {
    name = 'ExpandSellerCopilotConversationTitle1790000500000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(32)
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "seller_copilot_conversations"
            SET "title" = LEFT("title", 28)
            WHERE length("title") > 28
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(28)
        `);
    }
}
