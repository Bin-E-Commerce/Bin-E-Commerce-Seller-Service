import { MigrationInterface, QueryRunner } from 'typeorm';

// Chuẩn hóa title hiện có và giới hạn ở database để dữ liệu lịch sử không thể làm tràn sidebar về sau.
export class NormalizeSellerCopilotConversationTitles1790000100000 implements MigrationInterface {
    name = 'NormalizeSellerCopilotConversationTitles1790000100000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "seller_copilot_conversations"
            SET "title" = LEFT(
                REGEXP_REPLACE(BTRIM("title"), '\\s+', ' ', 'g'),
                36
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(36)
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_copilot_conversations"
            ALTER COLUMN "title" TYPE varchar(160)
        `);
    }
}
