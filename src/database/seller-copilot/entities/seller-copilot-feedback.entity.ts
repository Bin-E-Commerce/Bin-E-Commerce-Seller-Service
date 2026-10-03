import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

// Feedback gắn với message và owner để đánh giá chất lượng demo mà không dùng dữ liệu này để tự huấn luyện model.
@Entity('seller_copilot_feedback')
@Index(['ownerUserId', 'createdAt'])
export class SellerCopilotFeedback {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'message_id', type: 'uuid' })
    messageId: string;

    @Column({ name: 'owner_user_id', type: 'uuid' })
    ownerUserId: string;

    @Column({ name: 'shop_id', type: 'uuid' })
    shopId: string;

    @Column({ type: 'varchar', length: 8 })
    rating: 'up' | 'down';

    @Column({ type: 'varchar', length: 300, nullable: true })
    reason: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
