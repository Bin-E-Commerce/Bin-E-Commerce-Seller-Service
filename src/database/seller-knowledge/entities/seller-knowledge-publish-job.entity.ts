import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { SellerKnowledgePublishJobStatus } from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';

// Job lưu trạng thái lập chỉ mục và lỗi gần nhất để biết kết quả publish dù request HTTP đã kết thúc.
@Entity('seller_knowledge_publish_jobs')
@Index(['status', 'createdAt'])
export class SellerKnowledgePublishJob {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'revision_id', type: 'uuid' })
    revisionId: string;

    @Column({
        type: 'varchar',
        length: 20,
        default: SellerKnowledgePublishJobStatus.QUEUED,
    })
    status: SellerKnowledgePublishJobStatus;

    @Column({ type: 'integer', default: 0 })
    attempts: number;

    @Column({ name: 'last_error', type: 'text', nullable: true })
    lastError: string | null;

    @Column({ name: 'requested_by', type: 'uuid' })
    requestedBy: string;

    @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
    leaseUntil: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
