// Dịch vụ phân loại dùng chung cho cả bốn mode; không truy vấn nguồn hay tự sinh câu trả lời.
import { Inject, Injectable } from '@nestjs/common';
import {
    SELLER_QUESTION_CAPABILITY_REGISTRY,
    type SellerQuestionCapabilityRegistryProvider,
} from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/shared/context/seller-question-context.util';
import {
    SELLER_QUESTION_PLANNER,
    type SellerQuestionPlannerPort,
} from '@/modules/seller-copilot/application/question-understanding/shared/planner/contracts/seller-question-planner.port';
import { validateSellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/planner/validation/seller-question-plan.validator';
import type {
    SellerQuestionPlan,
    SellerQuestionPlannerFailure,
    SellerQuestionUnderstandingInput,
} from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

const DEFAULT_HISTORY_MESSAGE_LIMIT = 8;

// Service giới hạn/che lịch sử, đưa mode hiện tại vào planner và xác thực output model trước khi caller định tuyến.
@Injectable()
export class SellerQuestionUnderstandingService {
    constructor(
        @Inject(SELLER_QUESTION_PLANNER)
        private readonly planner: SellerQuestionPlannerPort,
        @Inject(SELLER_QUESTION_CAPABILITY_REGISTRY)
        private readonly registryProvider: SellerQuestionCapabilityRegistryProvider,
    ) {}

    // Chuẩn hóa đầu vào trước, bỏ qua provider nếu câu hỏi rỗng, rồi đưa registry hiện hành vào đúng một lần phân loại.
    // Registry là danh sách capability được backend tin cậy; planner không thể tự tạo domain hoặc mở quyền ngoài danh sách.
    // Abort giữ nguyên là hủy có chủ đích; provider lỗi và JSON sai schema được trả thành trạng thái kỹ thuật riêng.

    async understand(
        input: SellerQuestionUnderstandingInput,
    ): Promise<SellerQuestionPlan> {
        // Chuẩn hóa câu hỏi/lịch sử, che email/điện thoại phổ biến và giới hạn token; history chỉ giúp hiểu tham chiếu.
        const context = buildSellerQuestionContext({
            question: input.question,
            history: input.history,
            historyMessageLimit: DEFAULT_HISTORY_MESSAGE_LIMIT,
        });

        // Nếu câu hỏi trống thì không gửi request vô ích; trả clarification để caller giữ rõ đây không phải lỗi provider.
        if (!context.question) {
            return this.needsClarification(
                'Bạn gửi câu hỏi cụ thể hơn đi nè, để cho mình hiểu và trả lời chính xác nha 🙂.',
            );
        }

        // Gọi planner để phân loại câu hỏi; planner chỉ nhận câu hỏi và lịch sử đã xác minh; không truyền shop object, ID tenant hay dữ liệu hồ sơ đã đọc từ database.
        // Nạp registry trước lần gọi planner để domain vừa được kích hoạt có thể phân loại ngay trong request kế tiếp.
        const registry = await this.registryProvider.getActiveRegistry();
        const result = await this.planner.classify({
            ...context,
            interactionMode: input.interactionMode ?? 'chat',
            registry,
            signal: input.signal,
        });

        // Abort là yêu cầu dừng có chủ đích, không biến nó thành lỗi provider rồi lưu câu trả lời dự phòng.
        input.signal?.throwIfAborted();

        // Nếu planner trả về lỗi kỹ thuật thì trả về plan lỗi; caller quyết định cách phản hồi thân thiện qua luồng chat.
        if (result.kind === 'failure') {
            return this.plannerFailure(result.reason);
        }

        // Response từ model luôn là unknown: validator đối chiếu schema, domain, request type và quy tắc registry trước khi downstream tin dùng.
        const validated = validateSellerQuestionPlan(
            result.response,
            registry,
            input.interactionMode ?? 'chat',
        );

        // Chỉ plan đã qua validator mới được trả cho điều phối; JSON sai schema được giữ là lỗi planner, không rơi thành OUT_OF_SCOPE.
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
