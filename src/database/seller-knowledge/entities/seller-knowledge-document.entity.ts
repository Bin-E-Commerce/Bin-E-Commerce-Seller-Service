import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { SellerKnowledgeDocumentStatus } from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';

// Catalog metadata được truy vấn ở PostgreSQL; nội dung Markdown và revision bất biến nằm ở object storage.
@Entity('seller_knowledge_documents')
@Index(['domainCode', 'status', 'updatedAt'])
export class SellerKnowledgeDocument {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 160, unique: true })
    slug: string;

    @Column({ type: 'varchar', length: 200 })
    title: string;

    @Column({ name: 'domain_code', type: 'varchar', length: 80 })
    domainCode: string;

    @Column({ type: 'varchar', length: 10, default: 'vi' })
    language: string;

    @Column({
        type: 'varchar',
        length: 20,
        default: SellerKnowledgeDocumentStatus.DRAFT,
    })
    status: SellerKnowledgeDocumentStatus;

    @Column({ name: 'effective_from', type: 'date', nullable: true })
    effectiveFrom: string | null;

    @Column({ name: 'effective_to', type: 'date', nullable: true })
    effectiveTo: string | null;

    @Column({ name: 'published_revision_id', type: 'uuid', nullable: true })
    publishedRevisionId: string | null;

    @Column({ name: 'created_by', type: 'uuid' })
    createdBy: string;

    @Column({ name: 'updated_by', type: 'uuid' })
    updatedBy: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
