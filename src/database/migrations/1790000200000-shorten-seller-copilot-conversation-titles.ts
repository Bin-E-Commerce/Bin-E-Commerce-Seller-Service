import { MigrationInterface, QueryRunner } from 'typeorm';

// Rút ngắn title đã lưu và khóa giới hạn 28 ký tự để tên mới vừa sidebar BinGPT.
export class ShortenSellerCopilotConversationTitles1790000200000 implements MigrationInterface {
    name = 'ShortenSellerCopilotConversationTitles1790000200000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "seller_copilot_conversations"
            SET "title" = LEFT(BTRIM("title"), 28)
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(28)
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(36)
        `);
    }
}
