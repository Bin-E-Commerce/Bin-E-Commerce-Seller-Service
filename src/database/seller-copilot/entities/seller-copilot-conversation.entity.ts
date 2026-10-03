import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

// Conversation thuộc đúng owner/shop để lịch sử AI không trở thành đường vòng đọc dữ liệu shop khác.
@Entity('seller_copilot_conversations')
@Index(['ownerUserId', 'shopId', 'isPinned', 'pinnedAt', 'updatedAt'])
export class SellerCopilotConversation {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'owner_user_id', type: 'uuid' })
    ownerUserId: string;

    @Column({ name: 'shop_id', type: 'uuid' })
    shopId: string;

    @Column({ type: 'varchar', length: 32 })
    title: string;

    @Column({ name: 'is_pinned', type: 'boolean', default: false })
    isPinned: boolean;

    @Column({ name: 'pinned_at', type: 'timestamptz', nullable: true })
    pinnedAt: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
