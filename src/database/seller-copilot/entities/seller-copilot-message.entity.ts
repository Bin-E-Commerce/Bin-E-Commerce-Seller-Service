import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';
import type { SellerKnowledgeCitation } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type { SellerCopilotInventoryProposalPayload } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type {
    SellerCopilotAnswerStatus,
    SellerCopilotAnswerStatusReason,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';

// Message chỉ lưu nội dung hội thoại; không lưu system prompt hoặc chain-of-thought.
@Entity('seller_copilot_messages')
@Index(['conversationId', 'createdAt'])
export class SellerCopilotMessage {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'conversation_id', type: 'uuid' })
    conversationId: string;

    @Column({ type: 'varchar', length: 20 })
    role: 'user' | 'assistant' | 'system';

    @Column({ type: 'text' })
    content: string;

    // Metadata giữ citation và trạng thái xử lý để history/diagnostics hoạt động; không chứa prompt, vector hay raw retrieval scores.
    @Column({ type: 'jsonb', nullable: true })
    metadata: {
        citations?: SellerKnowledgeCitation[];
        incomplete?: boolean;
        answerStatus?: SellerCopilotAnswerStatus;
        answerStatusReason?: SellerCopilotAnswerStatusReason;
        dataSources?: Array<{
            kind: 'shop_data' | 'live_data' | 'seller_profile';
            label: string;
        }>;
        interactionMode?: 'chat' | 'shop_data' | 'knowledge' | 'agent';
        modeSessionId?: string;
        timelineEvent?: 'mode_changed';
        actionProposal?: {
            proposalId: string;
            payload: SellerCopilotInventoryProposalPayload;
            expiresAt: string;
            status?: 'pending' | 'completed' | 'failed';
            result?: Record<string, unknown>;
        };
    } | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
