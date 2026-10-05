import { MigrationInterface, QueryRunner } from 'typeorm';

// Tạo catalog metadata và lịch sử publish; nội dung Markdown vẫn được lưu bên ngoài PostgreSQL.
export class CreateSellerKnowledgeManagement1790000700000 implements MigrationInterface {
    name = 'CreateSellerKnowledgeManagement1790000700000';

    // Tạo domain trước các tài liệu để FK chặn publish vào domain đã bị xóa hoặc chưa đăng ký.
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "seller_knowledge_domains" (
                "code" varchar(80) PRIMARY KEY,
                "label" varchar(120) NOT NULL,
                "description" text NOT NULL,
                "examples" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "kind" varchar(20) NOT NULL DEFAULT 'knowledge',
                "implementation_key" varchar(100),
                "status" varchar(20) NOT NULL DEFAULT 'ACTIVE',
                "created_by" uuid NOT NULL,
                "updated_by" uuid NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_seller_knowledge_domain_kind"
                    CHECK ("kind" IN ('knowledge', 'live-data', 'profile')),
                CONSTRAINT "CHK_seller_knowledge_domain_status"
                    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "seller_knowledge_documents" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "slug" varchar(160) NOT NULL UNIQUE,
                "title" varchar(200) NOT NULL,
                "domain_code" varchar(80) NOT NULL REFERENCES "seller_knowledge_domains"("code"),
                "language" varchar(10) NOT NULL DEFAULT 'vi',
                "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
                "effective_from" date,
                "effective_to" date,
                "published_revision_id" uuid,
                "created_by" uuid NOT NULL,
                "updated_by" uuid NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_seller_knowledge_document_status"
                    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'EXPIRED', 'ARCHIVED')),
                CONSTRAINT "CHK_seller_knowledge_effective_dates"
                    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_seller_knowledge_documents_domain_status_updated"
            ON "seller_knowledge_documents" ("domain_code", "status", "updated_at" DESC)
        `);
        await queryRunner.query(`
            CREATE TABLE "seller_knowledge_revisions" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "document_id" uuid NOT NULL REFERENCES "seller_knowledge_documents"("id"),
                "revision_number" integer NOT NULL,
                "source_object_key" varchar(500) NOT NULL,
                "content_hash" varchar(64) NOT NULL,
                "content_size" integer NOT NULL,
                "status" varchar(20) NOT NULL DEFAULT 'DRAFT',
                "validation_report" jsonb,
                "created_by" uuid NOT NULL,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_seller_knowledge_revision_number"
                    UNIQUE ("document_id", "revision_number"),
                CONSTRAINT "CHK_seller_knowledge_revision_status"
                    CHECK ("status" IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'SUPERSEDED', 'FAILED'))
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "seller_knowledge_documents"
            ADD CONSTRAINT "FK_seller_knowledge_published_revision"
            FOREIGN KEY ("published_revision_id") REFERENCES "seller_knowledge_revisions"("id")
        `);
        await queryRunner.query(`
            CREATE TABLE "seller_knowledge_publish_jobs" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "revision_id" uuid NOT NULL REFERENCES "seller_knowledge_revisions"("id"),
                "status" varchar(20) NOT NULL DEFAULT 'QUEUED',
                "attempts" integer NOT NULL DEFAULT 0,
                "last_error" text,
                "requested_by" uuid NOT NULL,
                "lease_until" timestamptz,
                "created_at" timestamptz NOT NULL DEFAULT now(),
                "updated_at" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_seller_knowledge_job_status"
                    CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'))
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_seller_knowledge_publish_jobs_status_created"
            ON "seller_knowledge_publish_jobs" ("status", "created_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "seller_knowledge_audit_events" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "actor_id" uuid NOT NULL,
                "action" varchar(40) NOT NULL,
                "entity_type" varchar(40) NOT NULL,
                "entity_id" varchar(100) NOT NULL,
                "revision_id" uuid,
                "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "created_at" timestamptz NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_seller_knowledge_audit_entity_created"
            ON "seller_knowledge_audit_events" ("entity_type", "entity_id", "created_at" DESC)
        `);
    }

    // Bỏ các bảng theo thứ tự phụ thuộc để rollback không để lại FK mồ côi.
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_knowledge_audit_events"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_knowledge_publish_jobs"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_knowledge_revisions"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_knowledge_documents"',
        );
        await queryRunner.query(
            'DROP TABLE IF EXISTS "seller_knowledge_domains"',
        );
    }
}
