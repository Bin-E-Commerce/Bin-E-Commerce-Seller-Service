// Boundary giữa planner use case và OpenAI adapter; kết quả lỗi giữ phân biệt cấu hình, provider và JSON không hợp lệ.
import type { SellerQuestionPlannerFailure } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';

export const SELLER_QUESTION_PLANNER = Symbol('SELLER_QUESTION_PLANNER');

export type SellerQuestionPlannerResult =
    | {
          kind: 'success';
          response: unknown;
          usage?: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
          } | null;
      } // response chưa xác minh; usage chỉ phục vụ đánh giá, không ảnh hưởng định tuyến.
    | {
          kind: 'failure';
          reason: SellerQuestionPlannerFailure;
          usage?: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
          } | null;
      }; // Lỗi planner vẫn giữ usage nếu provider đã trả về, để báo cáo không đánh giá thiếu chi phí.

export interface SellerQuestionPlannerPort {
    // Chỉ phân loại câu hỏi đã chuẩn hóa theo registry; response thô vẫn phải qua validator ở application trước khi định tuyến.
    classify(input: {
        question: string; // Câu hỏi đã chuẩn hóa
        history: Array<{ role: 'user' | 'assistant'; content: string }>; // Lịch sử hội thoại đã chuẩn hóa
        interactionMode?: 'chat' | 'shop_data' | 'knowledge' | 'agent';
        registry: SellerQuestionCapabilityRegistry;
        signal?: AbortSignal; // Hủy request provider nếu client dừng stream.
    }): Promise<SellerQuestionPlannerResult>;
}
