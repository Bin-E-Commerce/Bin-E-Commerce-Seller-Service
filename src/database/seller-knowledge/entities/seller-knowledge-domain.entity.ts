import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';
import { SellerKnowledgeDomainStatus } from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';

// Domain chỉ mô tả phạm vi tri thức; các adapter live/action vẫn phải được đăng ký trong backend.
@Entity('seller_knowledge_domains')
export class SellerKnowledgeDomain {
    @PrimaryColumn({ type: 'varchar', length: 80 })
    code: string;

    @Column({ type: 'varchar', length: 120 })
    label: string;

    @Column({ type: 'text' })
    description: string;

    @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
    examples: string[];

    @Column({ type: 'varchar', length: 20, default: 'knowledge' })
    kind: 'knowledge' | 'live-data' | 'profile';

    @Column({
        name: 'implementation_key',
        type: 'varchar',
        length: 100,
        nullable: true,
    })
    implementationKey: string | null;

    @Column({
        type: 'varchar',
        length: 20,
        default: SellerKnowledgeDomainStatus.ACTIVE,
    })
    status: SellerKnowledgeDomainStatus;

    @Column({ name: 'created_by', type: 'uuid' })
    createdBy: string;

    @Column({ name: 'updated_by', type: 'uuid' })
    updatedBy: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
