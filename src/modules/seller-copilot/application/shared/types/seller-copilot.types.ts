// Request và event còn dùng bởi endpoint hội thoại hiện tại; các event của pipeline trả lời cũ đã được loại bỏ.

// Các khoảng thời gian được client có thể gửi cùng tin nhắn; tenant/shop luôn do backend tự xác định.
export type SellerCopilotRange = '7d' | '30d' | '90d';

// Payload chat đã qua DTO validation; không nhận shopId để client không thể chọn tenant khác.
export interface SellerCopilotRequest {
    conversationId?: string;
    message: string;
    range?: SellerCopilotRange;
    productId?: string;
}

// Tập event mà stream use case hiện thực sự phát; giữ nguyên payload SSE đang được frontend tiêu thụ.
export type SellerCopilotEvent =
    | { type: 'started'; conversationId: string; requestId: string }
    | { type: 'status'; phase: string; message: string }
    | { type: 'token'; text: string }
    | {
          type: 'done';
          dataAsOf: string;
          citations: unknown[];
          latencyMs: number;
      };
