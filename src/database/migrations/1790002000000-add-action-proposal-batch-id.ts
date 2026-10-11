import { MigrationInterface, QueryRunner } from 'typeorm';

// Thêm khóa nhóm tùy chọn để gom nhiều proposal theo một lần rà soát mà không đổi dữ liệu proposal cũ.
export class AddActionProposalBatchId1790002000000 implements MigrationInterface {
    name = 'AddActionProposalBatchId1790002000000';

    // Cột nullable giữ nguyên khả năng đọc/xác nhận các proposal tồn kho đã tạo trước migration.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "seller_copilot_action_proposals" ADD COLUMN "batch_id" uuid',
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_seller_copilot_action_proposals_batch_id" ON "seller_copilot_action_proposals" ("batch_id") WHERE "batch_id" IS NOT NULL',
        );
    }

    // Rollback chỉ bỏ thông tin nhóm mới, không xóa hoặc sửa payload proposal hiện có.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP INDEX IF EXISTS "IDX_seller_copilot_action_proposals_batch_id"',
        );
        await queryRunner.query(
            'ALTER TABLE "seller_copilot_action_proposals" DROP COLUMN "batch_id"',
        );
    }
}
