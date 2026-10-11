// Kết quả answer generator sau khi AI đã trả lời hoặc abstain; use case dùng shape này để lưu message/metadata.
import type {
    SellerCopilotAnswerStatus,
    SellerCopilotAnswerStatusReason,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { SellerKnowledgeCitation } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type {
    SellerCopilotDataSourceType,
    SellerCopilotInsight,
} from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Giữ metadata cùng câu trả lời để SSE và persistence sử dụng chung một kết quả đã kiểm chứng.
export interface GeneratedSellerCopilotAnswer {
    assistantReply: string;
    citations: SellerKnowledgeCitation[];
    dataSources: Array<{
        kind: SellerCopilotDataSourceType;
        label: string;
    }>;
    insights: SellerCopilotInsight[];
    answerStatus?: SellerCopilotAnswerStatus;
    answerStatusReason?: SellerCopilotAnswerStatusReason;
    assistantResponseStreamed: boolean;
}
