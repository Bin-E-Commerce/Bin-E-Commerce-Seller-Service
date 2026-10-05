// File khai báo ánh xạ audit Seller Knowledge; giữ tên cột theo migration và không xử lý nghiệp vụ ghi log.
import {
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    Column,
} from 'typeorm';

// Audit append-only ghi lại actor và revision liên quan; nội dung tài liệu không bị nhân bản vào log.
@Entity('seller_knowledge_audit_events')
@Index(['entityType', 'entityId', 'createdAt'])
export class SellerKnowledgeAuditEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'actor_id', type: 'uuid' })
    actorId: string;

    @Column({ type: 'varchar', length: 40 })
    action: string;

    @Column({ name: 'entity_type', type: 'varchar', length: 40 })
    entityType: string;

    @Column({ name: 'entity_id', type: 'varchar', length: 100 })
    entityId: string;

    @Column({ name: 'revision_id', type: 'uuid', nullable: true })
    revisionId: string | null;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    details: Record<string, unknown>;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
