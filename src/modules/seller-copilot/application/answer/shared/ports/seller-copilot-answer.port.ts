// Port sinh câu trả lời grounded tách orchestration khỏi OpenAI và giữ khả năng thay model/provider.
import type { SellerKnowledgeSearchHit } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type {
    SellerCopilotHistoryMessage,
    SellerCopilotInteractionMode,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type {
    SellerCopilotDataSourceType,
    SellerCopilotVisualizationType,
} from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

export const SELLER_COPILOT_ANSWER = Symbol('SELLER_COPILOT_ANSWER');

export interface SellerCopilotAnswerPort {
    // Phát delta có thể hiển thị và đúng một complete đã xác minh; evidence/context do backend cấp, model không gọi tool hay tự chọn tenant.
    stream(input: {
        question: string;
        evidence: SellerKnowledgeSearchHit[];
        contextData?: string;
        history?: SellerCopilotHistoryMessage[];
        interactionMode?: SellerCopilotInteractionMode;
        signal?: AbortSignal;
    }): AsyncGenerator<
        | { type: 'delta'; text: string }
        | {
              type: 'complete';
              answer: string;
              supported: boolean;
              visualizations?: SellerCopilotVisualizationType[];
              sourcesUsed?: SellerCopilotDataSourceType[];
          }
    >;
}
