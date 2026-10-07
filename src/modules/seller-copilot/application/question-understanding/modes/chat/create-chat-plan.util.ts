// Chính sách hiểu câu hỏi của mode Trò chuyện: coi nội dung hiện tại là small talk, không gọi planner hay mở nguồn shop.
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

// Giữ câu hỏi đã trim trong plan để answer nhận đúng nội dung người dùng, nhưng không tự gán domain nghiệp vụ.
export function createChatPlan(message: string): SellerQuestionPlan {
    // Chỉ chuẩn hóa khoảng trắng; không phân loại lại ngữ nghĩa hoặc gọi capability planner ở mode trò chuyện.
    const resolvedQuestion = message.trim();

    // Domain null giữ chốt định tuyến: downstream chỉ nhận small talk và không truy xuất shop/knowledge.
    return {
        status: 'READY',
        contextRelation: 'NEW_TOPIC',
        tasks: [
            {
                requestType: 'SMALL_TALK',
                domain: null,
                resolvedQuestion,
            },
        ],
        clarificationQuestion: null,
        failureReason: null,
    };
}
