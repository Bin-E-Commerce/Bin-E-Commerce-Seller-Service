import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { SellerKnowledgeRevisionStatus } from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';

// Revision giữ nguyên source key và hash để audit, kiểm tra nội dung và khôi phục mà không ghi đè bản cũ.
@Entity('seller_knowledge_revisions')
@Index(['documentId', 'revisionNumber'], { unique: true })
export class SellerKnowledgeRevision {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'document_id', type: 'uuid' })
    documentId: string;

    @Column({ name: 'revision_number', type: 'integer' })
    revisionNumber: number;

    @Column({ name: 'source_object_key', type: 'varchar', length: 500 })
    sourceObjectKey: string;

    @Column({ name: 'content_hash', type: 'varchar', length: 64 })
    contentHash: string;

    @Column({ name: 'content_size', type: 'integer' })
    contentSize: number;

    @Column({ name: 'document_metadata', type: 'jsonb' })
    documentMetadata: {
        slug: string;
        title: string;
        domainCode: string;
        language: string;
        effectiveFrom: string | null;
        effectiveTo: string | null;
    };

    @Column({
        type: 'varchar',
        length: 20,
        default: SellerKnowledgeRevisionStatus.DRAFT,
    })
    status: SellerKnowledgeRevisionStatus;

    @Column({ name: 'validation_report', type: 'jsonb', nullable: true })
    validationReport: Record<string, unknown> | null;

    @Column({ name: 'created_by', type: 'uuid' })
    createdBy: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
