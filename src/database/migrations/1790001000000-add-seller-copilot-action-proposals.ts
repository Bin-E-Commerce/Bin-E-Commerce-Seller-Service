import { MigrationInterface, QueryRunner } from 'typeorm';

// Lưu preview tồn kho có scope và hạn dùng để xác nhận một lần, kể cả khi service chạy nhiều instance.
export class AddSellerCopilotActionProposals1790001000000 implements MigrationInterface {
    name = 'AddSellerCopilotActionProposals1790001000000';

    // Bảng độc lập giữ trạng thái proposal; hội thoại cũ và message metadata không bị viết lại.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "seller_copilot_action_proposals" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "conversation_id" uuid NOT NULL,
                "owner_user_id" uuid NOT NULL,
                "shop_id" uuid NOT NULL,
                "status" varchar(40) NOT NULL,
                "payload" jsonb NOT NULL,
                "expires_at" timestamptz NOT NULL,
                "result" jsonb,
                "completed_at" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "FK_seller_copilot_action_proposals_conversation"
                    FOREIGN KEY ("conversation_id")
                    REFERENCES "seller_copilot_conversations"("id")
                    ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_seller_copilot_action_proposals_scope_status_expiry"
            ON "seller_copilot_action_proposals" ("owner_user_id", "shop_id", "status", "expires_at")
        `);
    }

    // Bảng chỉ chứa proposal mới, nên rollback chỉ xóa dữ liệu đã được feature này tạo.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_copilot_action_proposals"',
        );
    }
}
