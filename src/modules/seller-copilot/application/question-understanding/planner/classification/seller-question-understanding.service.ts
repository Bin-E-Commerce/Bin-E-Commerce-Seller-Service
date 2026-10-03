// Use case hiểu câu seller; chỉ phân loại/chuẩn hóa câu hỏi, không truy vấn nguồn dữ liệu hay tạo câu trả lời.
import { Inject, Injectable } from '@nestjs/common';
import {
    SELLER_QUESTION_CAPABILITY_REGISTRY,
    type SellerQuestionCapabilityRegistry,
} from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/context/seller-question-context.util';
import {
    SELLER_QUESTION_PLANNER,
    type SellerQuestionPlannerPort,
} from '@/modules/seller-copilot/application/question-understanding/planner/contracts/seller-question-planner.port';
import { validateSellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/planner/validation/seller-question-plan.validator';
import type {
    SellerQuestionPlan,
    SellerQuestionPlannerFailure,
    SellerQuestionUnderstandingInput,
} from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';

const DEFAULT_HISTORY_MESSAGE_LIMIT = 8;

@Injectable()
export class SellerQuestionUnderstandingService {
    constructor(
        @Inject(SELLER_QUESTION_PLANNER)
        private readonly planner: SellerQuestionPlannerPort,
        @Inject(SELLER_QUESTION_CAPABILITY_REGISTRY)
        private readonly registry: SellerQuestionCapabilityRegistry,
    ) {}

    // Mỗi tin nhắn đi qua đúng một planner call; lỗi provider và output sai schema được trả riêng, không giả thành câu chưa rõ.

    async understand(
        input: SellerQuestionUnderstandingInput,
    ): Promise<SellerQuestionPlan> {
        //  Chuẩn hóa câu hỏi và lịch sử; cắt bớt các tin nhắn cũ và giới hạn ký tự để tránh gửi dữ liệu hồ sơ nhạy cảm sang provider.
        const context = buildSellerQuestionContext({
            question: input.question,
            history: input.history,
            historyMessageLimit: DEFAULT_HISTORY_MESSAGE_LIMIT,
        });

        // Nếu câu hỏi trống thì không gửi request vô ích
        if (!context.question) {
            return this.needsClarification(
                'Bạn gửi câu hỏi cụ thể hơn đi nè, để cho mình hiểu và trả lời chính xác nha 🙂.',
            );
        }

        // Gọi planner để phân loại câu hỏi; planner chỉ nhận câu hỏi và lịch sử đã xác minh; không truyền shop object, ID tenant hay dữ liệu hồ sơ đã đọc từ database.
        const result = await this.planner.classify({
            ...context,
            registry: this.registry,
            signal: input.signal,
        });

        // Abort là yêu cầu dừng có chủ đích, không biến nó thành lỗi provider rồi lưu câu trả lời dự phòng.
        input.signal?.throwIfAborted();

        // Nếu planner trả về lỗi kỹ thuật thì trả về plan lỗi; caller quyết định cách phản hồi thân thiện qua luồng chat.
        if (result.kind === 'failure') {
            return this.plannerFailure(result.reason);
        }

        // Nếu planner trả về JSON chưa xác minh thì validate trước khi dùng; nếu sai schema thì trả về plan lỗi.
        const validated = validateSellerQuestionPlan(
            result.response,
            this.registry,
        );

        // Nếu planner trả về JSON hợp lệ thì trả về plan đã xác minh; caller có thể dùng plan để thực hiện nghiệp vụ.
        return validated ?? this.plannerFailure('AI_INVALID_RESPONSE');
    }

    // Lỗi planner được giữ riêng với NEEDS_CLARIFICATION để luồng chat báo trợ lý chưa sẵn sàng, không bắt user hỏi lại.
    private plannerFailure(
        reason: SellerQuestionPlannerFailure,
    ): SellerQuestionPlan {
        return {
            status:
                reason === 'AI_INVALID_RESPONSE'
                    ? 'PLANNER_INVALID_RESPONSE'
                    : 'PLANNER_UNAVAILABLE',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: null,
            failureReason: reason,
        };
    }

    // Input trống không gửi request vô ích và giữ câu hỏi làm rõ khác hẳn lỗi kỹ thuật planner.
    private needsClarification(question: string): SellerQuestionPlan {
        return {
            status: 'NEEDS_CLARIFICATION',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: question,
            failureReason: null,
        };
    }
}
