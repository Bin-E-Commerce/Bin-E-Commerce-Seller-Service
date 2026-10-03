import { MigrationInterface, QueryRunner } from 'typeorm';

// Tạo persistence tối thiểu cho lịch sử Seller Copilot; dữ liệu được scope bằng owner/shop và không chứa secret AI.
export class AddSellerCopilot1790000000000 implements MigrationInterface {
    name = 'AddSellerCopilot1790000000000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "seller_copilot_conversations" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "owner_user_id" uuid NOT NULL,
                "shop_id" uuid NOT NULL,
                "title" varchar(160) NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_seller_copilot_conversations_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_conversations_scope"
            ON "seller_copilot_conversations" ("owner_user_id", "shop_id", "updated_at")
        `);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "seller_copilot_messages" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "conversation_id" uuid NOT NULL,
                "role" varchar(20) NOT NULL,
                "content" text NOT NULL,
                "metadata" jsonb,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_seller_copilot_messages_id" PRIMARY KEY ("id"),
                CONSTRAINT "FK_seller_copilot_messages_conversation"
                    FOREIGN KEY ("conversation_id") REFERENCES "seller_copilot_conversations"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_messages_conversation_created"
            ON "seller_copilot_messages" ("conversation_id", "created_at")
        `);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "seller_copilot_feedback" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "message_id" uuid NOT NULL,
                "owner_user_id" uuid NOT NULL,
                "shop_id" uuid NOT NULL,
                "rating" varchar(8) NOT NULL,
                "reason" varchar(300),
                "created_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "PK_seller_copilot_feedback_id" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_seller_copilot_feedback_scope"
            ON "seller_copilot_feedback" ("owner_user_id", "created_at")
        `);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_copilot_feedback"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_copilot_messages"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_copilot_conversations"',
        );
    }
}
