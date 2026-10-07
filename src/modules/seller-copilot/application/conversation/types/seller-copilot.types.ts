// Request và event còn dùng bởi endpoint hội thoại hiện tại; các event của pipeline trả lời cũ đã được loại bỏ.
import type { SellerKnowledgeCitation } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type { SellerCopilotInsight } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Range chỉ còn để tương thích client cũ; UI mới để backend suy ra kỳ từ câu hỏi.
export type SellerCopilotRange = '7d' | '30d' | '90d' | 'current-month';
// Mode do UI chọn để backend quyết định nguồn; chỉ agent mới có thể tạo đề xuất ghi dữ liệu.
export type SellerCopilotInteractionMode =
    'chat' | 'shop_data' | 'knowledge' | 'agent';
export type SellerCopilotAnswerStatus =
    | 'answered'
    | 'partial'
    | 'in_development'
    | 'unsupported'
    | 'provider_error';
// Lý do backend abstain được lưu riêng để quan sát lỗi retrieval và lỗi grounding mà không đổi trạng thái UI.
export type SellerCopilotAnswerStatusReason =
    'no_retrieval_results' | 'insufficient_evidence' | 'provider_error';

// Bản lịch sử trung lập của conversation, dùng chung cho planner và answer mà không buộc hai phần phụ thuộc nhau.
export interface SellerCopilotHistoryMessage {
    // Role giới hạn user/assistant để system event và metadata không lọt vào prompt model.
    role: 'user' | 'assistant';
    // Nội dung đã được rút gọn/che dữ liệu ở question-understanding trước khi gửi provider.
    content: string;
}

// Payload chat đã qua DTO validation; không nhận shopId để client không thể chọn tenant khác.
export interface SellerCopilotRequest {
    conversationId?: string;
    message: string;
    range?: SellerCopilotRange;
    productId?: string;
    interactionMode?: SellerCopilotInteractionMode;
    modeSessionId?: string;
}

// Tập event mà stream use case hiện thực sự phát; giữ nguyên payload SSE đang được frontend tiêu thụ.
export type SellerCopilotEvent =
    | {
          type: 'started';
          conversationId: string;
          requestId: string;
          modeSessionId: string;
      }
    | { type: 'status'; phase: string; message: string }
    | { type: 'sources'; items: SellerKnowledgeCitation[] }
    | { type: 'answer_status'; status: SellerCopilotAnswerStatus }
    | { type: 'token'; text: string }
    | { type: 'replace'; text: string }
    | { type: 'warning'; code: string; message: string }
    | { type: 'insight'; items: SellerCopilotInsight[] }
    | {
          type: 'data_sources';
          items: Array<{
              kind: 'shop_data' | 'live_data' | 'seller_profile';
              label: string;
          }>;
      }
    | {
          type: 'action_proposed';
          proposalId: string;
          action: {
              kind: 'SET_INVENTORY';
              productId: string;
              productName: string;
              variantId: string;
              variantName: string;
              currentAvailable: number;
              nextAvailable: number;
          };
          expiresAt: string;
      }
    | {
          type: 'action_result';
          proposalId: string;
          status: 'completed' | 'failed';
          message: string;
          availableQuantity?: number;
      }
    | {
          type: 'done';
          dataAsOf: string;
          citations: SellerKnowledgeCitation[];
          latencyMs: number;
      };
