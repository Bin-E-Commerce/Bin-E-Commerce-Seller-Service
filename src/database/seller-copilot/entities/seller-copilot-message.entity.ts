import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

// Message chỉ lưu nội dung hội thoại; không lưu system prompt hoặc chain-of-thought.
@Entity('seller_copilot_messages')
@Index(['conversationId', 'createdAt'])
export class SellerCopilotMessage {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id', type: 'uuid' })
    conversationId: string;

    @Column({ type: 'varchar', length: 20 })
    role: 'user' | 'assistant';

    @Column({ type: 'text' })
    content: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
