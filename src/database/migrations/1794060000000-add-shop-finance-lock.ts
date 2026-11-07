import { MigrationInterface, QueryRunner } from 'typeorm';

// Đánh dấu riêng shop bị tạm ngưng do công nợ để khi đã thanh toán có thể mở lại đúng lý do.
export class AddShopFinanceLock1794060000000 implements MigrationInterface {
    name = 'AddShopFinanceLock1794060000000';

    // Giá trị mặc định false giữ nguyên trạng thái vận hành của toàn bộ shop hiện có.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "shops"
                ADD COLUMN IF NOT EXISTS "finance_locked" boolean NOT NULL DEFAULT FALSE
        `);
    }

    // Giữ trạng thái khóa đang hiệu lực để rollback không vô tình mở shop còn nợ.
    async down(queryRunner: QueryRunner): Promise<void> {
        const [result] = (await queryRunner.query(`
            SELECT COUNT(*)::int AS count FROM "shops" WHERE "finance_locked" = TRUE
        `)) as Array<{ count: number }>;
        if (Number(result?.count ?? 0) > 0)
            throw new Error(
                'Không thể rollback khi còn shop đang bị khóa do công nợ.',
            );
        await queryRunner.query(
            'ALTER TABLE "shops" DROP COLUMN IF EXISTS "finance_locked"',
        );
    }
}
