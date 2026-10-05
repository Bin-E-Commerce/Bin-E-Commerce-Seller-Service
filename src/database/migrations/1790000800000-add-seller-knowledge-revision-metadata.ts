import { MigrationInterface, QueryRunner } from 'typeorm';

// Bổ sung snapshot metadata cho revision mà không sửa lại migration tạo bảng đã có thể được môi trường khác chạy.
export class AddSellerKnowledgeRevisionMetadata1790000800000 implements MigrationInterface {
    name = 'AddSellerKnowledgeRevisionMetadata1790000800000';

    // Backfill lịch sử từ metadata hiện có; các revision mới sẽ lưu snapshot riêng khi được tạo.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_knowledge_revisions"
            ADD COLUMN IF NOT EXISTS "document_metadata" jsonb
        `);
        await queryRunner.query(`
            UPDATE "seller_knowledge_revisions" AS revision
            SET "document_metadata" = jsonb_build_object(
                'slug', document."slug",
                'title', document."title",
                'domainCode', document."domain_code",
                'language', document."language",
                'effectiveFrom', document."effective_from",
                'effectiveTo', document."effective_to"
            )
            FROM "seller_knowledge_documents" AS document
            WHERE revision."document_id" = document."id"
              AND revision."document_metadata" IS NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_knowledge_revisions"
            ALTER COLUMN "document_metadata" SET NOT NULL
        `);
    }

    // Bỏ cột snapshot để rollback schema; migration tạo bảng vẫn giữ nguyên trách nhiệm ban đầu.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "seller_knowledge_revisions"
            DROP COLUMN IF EXISTS "document_metadata"
        `);
    }
}
