import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/shared/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/planner/classification/seller-question-understanding.service';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';
import { buildSellerCopilotConversationTitle } from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';
import type {
    SellerCopilotEvent,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/shared/types/seller-copilot.types';

// Snapshot tenant và conversation đã được xác minh trước khi controller gửi SSE headers.
export interface PreparedSellerCopilotChat {
    ownerUserId: string;
    shopId: string;
    conversationId: string;
}

const COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE =
    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂';
const COPILOT_AI_UNAVAILABLE_MESSAGE =
    'Hiện tại trợ lý AI chưa sẵn sàng. Bạn quay lại sau giúp mình nhé 🙂';
const COPILOT_OUT_OF_SCOPE_MESSAGE =
    'Mình tập trung hỗ trợ việc quản lý shop như sản phẩm, đơn hàng, doanh thu, tồn kho và chính sách seller nhé 🙂';
const COPILOT_SMALL_TALK_MESSAGE =
    'Mình đây 🙂 Bạn cần mình hỗ trợ gì về shop?';

const COPILOT_NEEDS_CLARIFICATION_MESSAGE =
    'Bạn nói rõ hơn một chút để mình hiểu đúng ý nhé 🙂.';
// Các câu này chỉ báo planner/answer chưa sẵn sàng, không giúp hiểu lượt kế tiếp.
const TRANSIENT_ASSISTANT_REPLIES = new Set([
    COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE,
    COPILOT_AI_UNAVAILABLE_MESSAGE,
]);
const QUESTION_HISTORY_FETCH_LIMIT = 16;

// Điều phối một lượt chat: xác thực tenant, nạp lịch sử an toàn, gọi planner phân loại và phát SSE.
// Use case không truy vấn dữ liệu shop/chính sách và không sinh đáp án nghiệp vụ; các phần đó thuộc phase retrieval/answer.
@Injectable()
export class StreamSellerCopilotUseCase {
    private readonly logger = new Logger(StreamSellerCopilotUseCase.name);

    constructor(
        private readonly access: SellerCopilotAccessService,
        private readonly understanding: SellerQuestionUnderstandingService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Xác thực tenant và kiểm tra conversation trước khi mở SSE để lỗi quyền/ID sai vẫn giữ HTTP status chuẩn.
    // Trả về đúng scope đã xác minh để execute không truy vấn shop lần hai và không tin shopId từ request.
    async prepare(
        ownerUserId: string | undefined,
        request: SellerCopilotRequest,
    ): Promise<PreparedSellerCopilotChat> {
        const shop = await this.access.resolveActiveShop(ownerUserId);

        const conversation = await this.getOrCreateConversation(
            shop.ownerUserId,
            shop.id,
            request.conversationId,
            request.message,
        );

        return {
            ownerUserId: shop.ownerUserId,
            shopId: shop.id,
            conversationId: conversation.id,
        };
    }

    // Xác minh tenant trước khi đọc hội thoại, lấy context gần nhất rồi phân loại câu hỏi bằng đúng một planner call.
    // History được lấy sau khi conversation đã được xác minh; bộ dựng context sẽ giới hạn độ dài và che dữ liệu hồ sơ/định danh.
    // Phase này chỉ dùng plan để xử lý xã giao, làm rõ, ngoài phạm vi và lỗi planner; nghiệp vụ READY vẫn chờ phase retrieval/answer.
    async *execute(
        preparedChat: PreparedSellerCopilotChat,
        request: SellerCopilotRequest,
        requestId: string = randomUUID(),
        signal?: AbortSignal,
    ): AsyncGenerator<SellerCopilotEvent> {
        // Lấy thời gian bắt đầu để tính độ trễ
        const startedAt = Date.now();

        // === BƯỚC 1: Nạp ngữ cảnh đã thuộc tenant được xác minh ===

        // Lấy tối đa 16 tin nhắn mới nhất; repository trả lại theo thứ tự hội thoại để planner đọc đúng mạch.
        // Việc loại thông báo tạm thời và giữ câu assistant hữu ích được thực hiện ở bước dựng history bên dưới.
        const recentMessages = await this.repository.findMessagesByConversation(
            preparedChat.conversationId,
            QUESTION_HISTORY_FETCH_LIMIT,
        );

        // Giữ câu trả lời assistant hữu ích, nhất là câu hỏi làm rõ để planner hiểu câu trả lời tiếp theo như “cả hai”.
        // Chỉ loại các câu báo tạm thời đã biết; nội dung này không mang thông tin hội thoại và dễ làm nhiễu follow-up.
        const history = recentMessages
            .filter(
                (message) =>
                    message.role !== 'assistant' ||
                    !TRANSIENT_ASSISTANT_REPLIES.has(message.content),
            )
            .map((message) => ({
                role: message.role,
                content: message.content,
            }));

        // Ghi câu user trước khi gọi provider để không làm mất câu hỏi nếu request AI gặp lỗi; history ở trên chưa chứa câu hiện tại.
        await this.repository.saveMessage({
            conversationId: preparedChat.conversationId,
            role: 'user',
            content: request.message.trim(),
        });

        // Gửi conversationId ngay sau khi lưu câu hỏi để client nhận event trước khi chờ planner.
        // Nếu request bị hủy, câu user vẫn đã được lưu trong đúng hội thoại.
        yield {
            type: 'started',
            conversationId: preparedChat.conversationId,
            requestId,
        };

        // === BƯỚC 2: Phân loại câu hỏi và lưu phản hồi ===

        // Mục đích lấy plan là để xác định phản hồi xã giao, làm rõ, ngoài phạm vi và lỗi planner; không dùng plan để thực hiện nghiệp vụ.
        // Nếu plan trả về READY thì vẫn chỉ phản hồi xã giao tạm thời; các phase retrieval/answer sẽ được tích hợp sau.
        // Plan không được lưu vào hội thoại để tránh lộ thông tin phân loại và lỗi planner cho tenant.
        const plan = await this.understanding.understand({
            question: request.message.trim(),
            history,
            signal,
        });

        // Provider có thể trả kết quả đúng lúc browser vừa bấm Dừng; không ghi thêm câu trả lời cho lượt đã hủy.
        signal?.throwIfAborted();

        this.logPlanSummary(plan);

        // Chọn phản hồi xã giao/làm rõ/ngoài phạm vi/lỗi planner để phát cho client; không dùng plan để thực hiện nghiệp vụ.
        const assistantReply = this.buildPhaseOneReply(plan);

        // Kiểm tra lần cuối sát điểm ghi để tránh lưu assistant nếu client vừa hủy trong lúc dựng phản hồi.
        signal?.throwIfAborted();

        // Lưu đúng nội dung sẽ phát để refresh/reconnect hiển thị nhất quán; không lưu plan hay output phân loại vào hội thoại.
        await this.repository.saveMessage({
            conversationId: preparedChat.conversationId,
            role: 'assistant',
            content: assistantReply,
        });

        // === BƯỚC 3: Phát event SSE theo contract hiện tại ===
        // Phát nội dung đã chọn từ plan để client hiển thị; token ở đây là một chunk hoàn chỉnh, không phải token model.
        yield { type: 'token', text: assistantReply };

        // Phát event done để client biết đã hoàn tất; client có thể dọn dẹp trạng thái loading.
        yield {
            type: 'done',
            dataAsOf: new Date().toISOString(),
            citations: [],
            latencyMs: Date.now() - startedAt,
        };
    }

    // Ghi metric phân loại đã loại dữ liệu nhận dạng để theo dõi nhóm câu hỏi và lỗi planner trong môi trường thật.
    // Không log câu gốc, resolvedQuestion, owner/shop ID hay nội dung hồ sơ để log không trở thành bản sao hội thoại.
    private logPlanSummary(plan: SellerQuestionPlan): void {
        this.logger.log(
            JSON.stringify({
                event: 'seller_question_classified',
                status: plan.status,
                contextRelation: plan.contextRelation,
                taskCount: plan.tasks.length,
                requestTypes: plan.tasks.map((task) => task.requestType),
                domains: [
                    ...new Set(
                        plan.tasks
                            .map((task) => task.domain)
                            .filter(
                                (domain): domain is string => domain !== null,
                            ),
                    ),
                ],
                failureReason: plan.failureReason,
            }),
        );
    }

    // Chọn phản hồi giới hạn cho Phase 1: plan không được biến thành câu trả lời nghiệp vụ hoặc quyền thực thi thao tác.
    // Chỉ clarification đã validate, xã giao và ngoài phạm vi có thể phản hồi ngay; lỗi planner được phân biệt với câu chưa rõ.
    // Với yêu cầu seller READY, giữ thông báo tạm thời cho tới khi các phase retrieval/live-data/answer được tích hợp.
    private buildPhaseOneReply(plan: SellerQuestionPlan): string {
        if (
            plan.status === 'PLANNER_UNAVAILABLE' ||
            plan.status === 'PLANNER_INVALID_RESPONSE'
        ) {
            return COPILOT_AI_UNAVAILABLE_MESSAGE;
        }

        if (plan.status === 'NEEDS_CLARIFICATION') {
            return (
                plan.clarificationQuestion ??
                COPILOT_NEEDS_CLARIFICATION_MESSAGE
            );
        }

        if (plan.status === 'OUT_OF_SCOPE') {
            return COPILOT_OUT_OF_SCOPE_MESSAGE;
        }

        if (
            plan.tasks.length > 0 &&
            plan.tasks.every((task) => task.requestType === 'SMALL_TALK')
        ) {
            return COPILOT_SMALL_TALK_MESSAGE;
        }

        return COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE;
    }

    // Tin conversationId từ client chỉ sau khi repository xác nhận đồng thời owner và shop; ID lạ không được tiết lộ.
    // Không có ID thì tạo hội thoại gắn với tenant do access service resolve, không dùng shopId từ request.
    private async getOrCreateConversation(
        ownerUserId: string,
        shopId: string,
        conversationId: string | undefined,
        message: string,
    ) {
        // Nếu không có conversationId thì tạo hội thoại mới với title dựa trên message; repository trả về record mới.
        if (!conversationId) {
            return this.repository.createConversation({
                ownerUserId,
                shopId,
                title: buildSellerCopilotConversationTitle(message),
            });
        }

        // Nếu có conversationId thì tìm hội thoại trong tenant hiện tại; nếu không tìm thấy thì throw lỗi HTTP 404.
        const conversation = await this.repository.findConversation(
            { ownerUserId, shopId },
            conversationId,
        );

        // Nếu không tìm thấy hội thoại thì throw lỗi HTTP 404; không reveal thông tin hội thoại cho client.
        if (!conversation) {
            throw new NotFoundException('Conversation không tồn tại.');
        }

        return conversation;
    }
}
