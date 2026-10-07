// Proposal lưu trạng thái xác nhận tồn kho giữa các request; payload luôn gắn owner/shop và có hạn dùng.
import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';
import type { SellerCopilotInventoryProposalPayload } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';

@Entity('seller_copilot_action_proposals')
@Index(['ownerUserId', 'shopId', 'status', 'expiresAt'])
export class SellerCopilotActionProposal {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id', type: 'uuid' })
    conversationId: string;

    @Column({ name: 'owner_user_id', type: 'uuid' })
    ownerUserId: string;

    @Column({ name: 'shop_id', type: 'uuid' })
    shopId: string;

    @Column({ type: 'varchar', length: 40 })
    status: 'pending' | 'processing' | 'completed' | 'failed';

    @Column({ type: 'jsonb' })
    payload: SellerCopilotInventoryProposalPayload;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt: Date;

    @Column({ name: 'result', type: 'jsonb', nullable: true })
    result: Record<string, unknown> | null;

    @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
    completedAt: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
