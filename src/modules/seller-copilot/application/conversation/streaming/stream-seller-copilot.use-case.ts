// Điều phối chat Seller Copilot từ xác thực tenant tới phân loại, truy xuất, tạo câu trả lời và lưu citation.
// Use case không truy vấn database trực tiếp; scope tenant và persistence luôn đi qua các service/port tương ứng.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { buildSellerCopilotQuestionHistory } from '@/modules/seller-copilot/application/conversation/history/build-seller-copilot-question-history.util';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/shared/planner/seller-question-understanding.service';
import type {
    SellerCopilotEvent,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import { SellerProductAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-product-agent.service';
import { resolveShopDataPresentation } from '@/modules/seller-copilot/application/answer/modes/shop-data/presentation/resolve-shop-data-presentation.util';
import { resolveProductDetailFollowUp } from '@/modules/seller-copilot/application/answer/modes/shop-data/follow-ups/resolve-product-detail-follow-up.util';
import { resolveAgentSkuPriceFollowUp } from '@/modules/seller-copilot/application/answer/modes/agent/follow-ups/resolve-agent-sku-price-follow-up.util';
import { resolveAgentInventoryFollowUp } from '@/modules/seller-copilot/application/answer/modes/agent/follow-ups/resolve-agent-inventory-follow-up.util';
import { resolveAgentClearanceFollowUp } from '@/modules/seller-copilot/application/answer/modes/agent/follow-ups/resolve-agent-clearance-follow-up.util';
import {
    resolveChatModeHandoff,
    resolveKnowledgeModeHandoff,
} from '@/modules/seller-copilot/application/answer/modes/chat/resolve-chat-mode-handoff.util';
import {
    buildSellerCopilotInitialReply,
    logSellerCopilotPlanSummary,
} from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-plan.util';
import { routeSellerCopilotTasks } from '@/modules/seller-copilot/application/answer/shared/utils/route-seller-copilot-tasks.util';
import {
    SELLER_QUESTION_CAPABILITY_REGISTRY,
    type SellerQuestionCapabilityRegistryProvider,
} from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import type { PreparedSellerCopilotChat } from '@/modules/seller-copilot/application/conversation/streaming/types/prepared-seller-copilot-chat.types';
import { LoadSellerCopilotContextService } from '@/modules/seller-copilot/application/conversation/streaming/services/load-seller-copilot-context.service';
import { GenerateGroundedSellerAnswerService } from '@/modules/seller-copilot/application/conversation/streaming/services/generate-grounded-seller-answer.service';
import { PrepareSellerCopilotChatUseCase } from '@/modules/seller-copilot/application/conversation/streaming/prepare-seller-copilot-chat.use-case';
import type { GeneratedSellerCopilotAnswer } from '@/modules/seller-copilot/application/conversation/streaming/types/generated-seller-copilot-answer.types';

const COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE =
    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂';
const COPILOT_ACTION_NOT_SUPPORTED_MESSAGE =
    'Mình có thể tra cứu chính sách và hướng dẫn đã xuất bản, nhưng hiện chưa thể thay đổi dữ liệu hoặc thực hiện thao tác thay bạn.';
const QUESTION_HISTORY_FETCH_LIMIT = 16;

// Điều phối một lượt chat: xác thực tenant, nạp lịch sử an toàn, phân loại, truy xuất evidence và phát SSE có citation.
// Use case không truy vấn persistence trực tiếp; mọi message, knowledge và answer đều đi qua service/port ứng dụng.
@Injectable()
// Orchestrator giữ thứ tự tenant → planner → retrieval → answer → persistence cho một lượt chat.
export class StreamSellerCopilotUseCase {
    private readonly logger = new Logger(StreamSellerCopilotUseCase.name);

    // Các dependency là application services/ports để use case không phụ thuộc HTTP client hoặc ORM.
    constructor(
        private readonly prepareChat: PrepareSellerCopilotChatUseCase,
        private readonly understanding: SellerQuestionUnderstandingService,
        private readonly inventoryAgent: SellerInventoryAgentService,
        private readonly productAgent: SellerProductAgentService,
        private readonly contextLoader: LoadSellerCopilotContextService,
        private readonly answerGenerator: GenerateGroundedSellerAnswerService,
        @Inject(SELLER_QUESTION_CAPABILITY_REGISTRY)
        private readonly registryProvider: SellerQuestionCapabilityRegistryProvider,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Xác thực tenant và kiểm tra conversation trước khi mở SSE để lỗi quyền/ID sai vẫn giữ HTTP status chuẩn.
    // Trả về đúng scope đã xác minh để execute không truy vấn shop lần hai và không tin shopId từ request.
    async prepare(
        ownerUserId: string | undefined,
        request: SellerCopilotRequest,
        userContext: { email?: string; permissions?: string[] } = {},
    ): Promise<PreparedSellerCopilotChat> {
        // Giữ nguyên API prepare mà controller/tests đang gọi; xử lý xác thực và tạo scope đã tách sang use case riêng.
        return this.prepareChat.execute(ownerUserId, request, userContext);
    }

    // Xác minh tenant trước, sau đó xử lý mode Chat/Shop trực tiếp hoặc chỉ gọi planner cho Knowledge/Agent.
    // History chỉ giúp hiểu câu tiếp nối; nguồn bằng chứng luôn lấy từ mode hiện tại, không lấy từ message cũ.
    // Mọi thay đổi dữ liệu chỉ có thể tạo proposal trong Agent và phải qua xác nhận riêng trước khi ghi.
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

        const interactionMode = request.interactionMode ?? 'chat';
        const clearanceFollowUp =
            interactionMode === 'agent'
                ? resolveAgentClearanceFollowUp({
                      recentMessages,
                      modeSessionId: preparedChat.modeSessionId,
                      question: request.message,
                  })
                : { message: request.message, contextMessages: [] };
        const explicitAgentAction =
            interactionMode === 'agent'
                ? detectAgentAction(request.message) ??
                  (clearanceFollowUp.contextMessages.length > 0
                      ? 'slow_moving_price'
                      : null)
                : null;
        const history = buildSellerCopilotQuestionHistory(
            recentMessages,
            preparedChat.modeSessionId,
            interactionMode,
        );

        // Ghi mode trên user message để lịch sử vẫn giải thích được câu trả lời đến từ nguồn nào sau khi reload.
        await this.repository.saveMessage({
            conversationId: preparedChat.conversationId,
            role: 'user',
            content: request.message.trim(),
            metadata: {
                interactionMode,
                modeSessionId: preparedChat.modeSessionId,
            },
        });

        // Gửi conversationId ngay sau khi lưu câu hỏi để client nhận event trước khi chờ planner.
        // Nếu request bị hủy, câu user vẫn đã được lưu trong đúng hội thoại.
        yield {
            type: 'started',
            conversationId: preparedChat.conversationId,
            requestId,
            modeSessionId: preparedChat.modeSessionId,
        };

        yield {
            type: 'status',
            // Phase và copy phải cùng đi theo mode đã chuẩn hóa; UI dùng phase để phản ánh đúng bước backend đang chờ.
            phase:
                interactionMode === 'chat'
                    ? 'answer'
                    : interactionMode === 'shop_data'
                      ? 'live_data'
                      : 'understanding',
            message:
                interactionMode === 'chat'
                    ? 'Đang trò chuyện với BinGPT…'
                    : interactionMode === 'shop_data'
                      ? 'Đang chuẩn bị dữ liệu shop…'
                      : 'Đang hiểu câu hỏi và ngữ cảnh hội thoại…',
        };

        // Cả bốn mode dùng cùng bộ hiểu ý định; mode truyền vào chỉ đổi chính sách phân loại, không tự mở quyền truy xuất.
        // Chat cũng cần planner để phát hiện yêu cầu cần shop data/tài liệu/Agent, sau đó chỉ hướng dẫn đổi mode.
        const generatedPlan = await this.understanding.understand({
            question: request.message.trim(),
            history,
            interactionMode,
            signal,
        });
        // Đại từ chỉ sản phẩm được nối với insight backend gần nhất trong cùng phiên; route vẫn qua registry trước khi gọi Product Service.
        const followUpPlan =
            interactionMode === 'shop_data' || interactionMode === 'agent'
                ? resolveProductDetailFollowUp({
                      plan: generatedPlan,
                      recentMessages,
                      modeSessionId: preparedChat.modeSessionId,
                      interactionMode,
                  })
                : generatedPlan;
        const plan =
            interactionMode === 'agent'
                ? resolveAgentSkuPriceFollowUp({
                      plan: followUpPlan,
                      recentMessages,
                      modeSessionId: preparedChat.modeSessionId,
                      question: request.message,
                  })
                : followUpPlan;
        // Chỉ nối “sản phẩm này/đó” khi planner xác nhận đúng một lệnh tồn kho và insight gần nhất có ID/SKU duy nhất.
        const inventoryFollowUp =
            interactionMode === 'agent'
                ? resolveAgentInventoryFollowUp({
                      plan,
                      recentMessages,
                      modeSessionId: preparedChat.modeSessionId,
                      question: request.message,
                  })
                : { kind: 'not_applicable' as const };

        // Provider có thể trả kết quả đúng lúc browser vừa bấm Dừng; không ghi thêm câu trả lời cho lượt đã hủy.
        signal?.throwIfAborted();

        if (interactionMode === 'knowledge' || interactionMode === 'agent') {
            logSellerCopilotPlanSummary(this.logger, plan, requestId);
        }

        // Các tác vụ thay đổi phải qua agent mode riêng; mode đọc và trò chuyện không được biến lời nói thành lệnh.
        let chatModeHandoff: string | null = null;
        if (
            interactionMode === 'chat' &&
            plan.status === 'READY' &&
            plan.tasks.some(
                (task) =>
                    task.requestType === 'READ_QUERY' ||
                    task.requestType === 'CHANGE_REQUEST' ||
                    task.requestType === 'CAPABILITY_QUERY',
            )
        ) {
            // Chỉ nạp registry khi có yêu cầu đọc để xác định mode nguồn; hỏi capability dùng câu trả lời tĩnh, không cần nguồn.
            const hasReadQuery = plan.tasks.some(
                (task) => task.requestType === 'READ_QUERY',
            );
            const registry = hasReadQuery
                ? await this.registryProvider.getActiveRegistry()
                : { domains: [] };
            const domainKinds = new Map(
                registry.domains.map((domain) => [domain.code, domain.kind]),
            );
            chatModeHandoff = resolveChatModeHandoff(plan.tasks, domainKinds);
        }

        // Handoff được quyết định trước pipeline đọc/ghi; nếu không cần đổi mode, Chat tiếp tục xử lý hội thoại phổ thông.
        let assistantReply =
            chatModeHandoff ??
            buildSellerCopilotInitialReply(plan, interactionMode);
        let citations: GeneratedSellerCopilotAnswer['citations'] = [];
        let dataSources: GeneratedSellerCopilotAnswer['dataSources'] = [];
        let insights: GeneratedSellerCopilotAnswer['insights'] = [];
        let answerStatus: GeneratedSellerCopilotAnswer['answerStatus'];
        let answerStatusReason: GeneratedSellerCopilotAnswer['answerStatusReason'];
        if (
            plan.status === 'PLANNER_UNAVAILABLE' ||
            plan.status === 'PLANNER_INVALID_RESPONSE'
        ) {
            // Lỗi planner là lỗi dịch vụ, không được hiển thị như kết quả shop rỗng hay câu trả lời thiếu dữ liệu.
            answerStatus = 'provider_error';
            answerStatusReason = 'provider_error';
        }
        let assistantResponseStreamed = false;
        let actionProposalMetadata:
            | NonNullable<
                  Parameters<
                      SellerCopilotRepositoryPort['saveMessage']
                  >[0]['metadata']
              >['actionProposal']
            | undefined;
        let actionProposalsMetadata: NonNullable<
            Parameters<
                SellerCopilotRepositoryPort['saveMessage']
            >[0]['metadata']
        >['actionProposals'];
        if (plan.status === 'READY' && !chatModeHandoff) {
            // Chỉ plan READY đã xác thực CHANGE_REQUEST mới mở nhánh preview; @command chỉ chọn loại preview, không cấp quyền ghi.
            // @xả-hàng là lựa chọn tác vụ tường minh; vẫn chỉ tạo preview và service sẽ từ chối nếu thiếu tiêu chí.
            const explicitClearanceAction =
                interactionMode === 'agent' &&
                explicitAgentAction === 'slow_moving_price';
            const hasMutationRequest =
                explicitClearanceAction ||
                plan.tasks.some(
                    (task) => task.requestType === 'CHANGE_REQUEST',
                );
            const rawAnswerTasks = plan.tasks.filter(
                (task) =>
                    task.requestType === 'READ_QUERY' ||
                    task.requestType === 'CAPABILITY_QUERY' ||
                    task.requestType === 'SMALL_TALK',
            );
            const shopDataPresentation =
                interactionMode === 'shop_data' || interactionMode === 'agent'
                    ? resolveShopDataPresentation({
                          tasks: rawAnswerTasks,
                      })
                    : null;
            const answerTasks = shopDataPresentation?.tasks ?? rawAnswerTasks;

            // Mọi write phải đến từ agent mode và domain allowlist; chat thường không được biến lời nói thành lệnh.
            if (hasMutationRequest) {
                let readAnswerReply: string | null = null;
                let readAnswerStreamed = false;
                let readBlocked = false;

                // Nếu người bán hỏi dữ liệu trước khi yêu cầu đổi, hoàn tất câu trả lời live trước khi chuẩn bị preview.
                // Truy vấn inventory/sales của xả hàng được service chuyên biệt thực hiện cùng một bộ lọc nhất quán;
                // bỏ câu trả lời đọc chung để planner không trả danh sách gần đúng thay cho preview đã kiểm tra.
                const agentReadTasks = explicitClearanceAction
                    ? answerTasks.filter(
                          (task) =>
                              task.requestType === 'READ_QUERY' &&
                              task.domain !== 'seller-products-inventory' &&
                              task.domain !== 'seller-orders',
                      )
                    : answerTasks.filter(
                          (task) => task.requestType === 'READ_QUERY',
                      );
                if (interactionMode === 'agent' && agentReadTasks.length) {
                    const readResult = yield* this.answerReadTasks({
                        preparedChat,
                        request,
                        interactionMode,
                        plan,
                        answerTasks: agentReadTasks,
                        history,
                        shopDataPresentation,
                        initialReply: assistantReply,
                        requestId,
                        signal,
                    });
                    assistantReply = readResult.assistantReply;
                    readAnswerReply = readResult.assistantReply;
                    readAnswerStreamed = readResult.assistantResponseStreamed;
                    readBlocked = readResult.blocked;
                    citations = readResult.citations;
                    dataSources = readResult.dataSources;
                    insights = readResult.insights;
                    answerStatus = readResult.answerStatus;
                    answerStatusReason = readResult.answerStatusReason;
                    assistantResponseStreamed =
                        readResult.assistantResponseStreamed;
                }

                if (readBlocked) {
                    // Câu hỏi sai nguồn hoặc chưa route an toàn thì không được phép tạo proposal đi kèm.
                } else {
                    const registry =
                        await this.registryProvider.getActiveRegistry();
                    const inventoryDomain = registry.domains.find(
                        (domain) => domain.code === 'seller-products-inventory',
                    );
                    const inventoryChanges = plan.tasks.filter(
                        (task) =>
                            task.requestType === 'CHANGE_REQUEST' &&
                            task.domain === 'seller-products-inventory',
                    );
                    // Nếu plan chứa thêm một lệnh ghi domain khác, từ chối toàn bộ thay vì thực thi một phần rồi bỏ phần còn lại.
                    const hasUnsupportedChange = plan.tasks.some(
                        (task) =>
                            task.requestType === 'CHANGE_REQUEST' &&
                            task.domain !== 'seller-products-inventory',
                    );

                    if (
                        interactionMode !== 'agent' ||
                        inventoryDomain?.kind !== 'live-data' ||
                        hasUnsupportedChange ||
                        (explicitClearanceAction
                            ? inventoryChanges.length > 1
                            : inventoryChanges.length !== 1)
                    ) {
                        // Chỉ một mutation tồn kho duy nhất, agent mode và domain đang bật live-data mới qua được chốt này.
                        assistantReply = COPILOT_ACTION_NOT_SUPPORTED_MESSAGE;
                    } else {
                        yield {
                            type: 'status',
                            phase: 'action_preview',
                            message: 'Đang chuẩn bị bản xem trước…',
                        };
                        const actionInput = {
                            ownerUserId: preparedChat.ownerUserId,
                            shopId: preparedChat.shopId,
                            conversationId: preparedChat.conversationId,
                            message:
                                inventoryFollowUp.kind === 'resolved' &&
                                !plan.tasks.some(
                                    (task) => task.requestType === 'READ_QUERY',
                                )
                                    ? request.message
                                    : (inventoryChanges[0]?.resolvedQuestion ??
                                      request.message),
                        };
                        if (inventoryFollowUp.kind === 'clarification') {
                            // Không gọi service tạo proposal khi tham chiếu cũ mơ hồ; yêu cầu seller nêu đúng biến thể/SKU.
                            assistantReply = inventoryFollowUp.message;
                        } else {
                            const preparedAction =
                                explicitAgentAction === 'slow_moving_price'
                                    ? await this.productAgent.prepareSlowMovingPriceChange(
                                          {
                                              ...actionInput,
                                              message: clearanceFollowUp.message,
                                              ...(clearanceFollowUp.contextMessages
                                                  .length > 0
                                                  ? {
                                                        contextMessages:
                                                            clearanceFollowUp.contextMessages,
                                                    }
                                                  : {}),
                                          },
                                      )
                                    : explicitAgentAction === 'price'
                                    ? await this.productAgent.preparePriceChange(
                                          actionInput,
                                      )
                                    : explicitAgentAction === 'content'
                                      ? await this.productAgent.prepareContentChange(
                                            actionInput,
                                        )
                                      : explicitAgentAction === 'low_stock'
                                        ? await this.productAgent.prepareLowStock(
                                              actionInput,
                                          )
                                        : await this.inventoryAgent.prepare({
                                              ...actionInput,
                                              ...(inventoryFollowUp.kind ===
                                              'resolved'
                                                  ? {
                                                        target: inventoryFollowUp.target,
                                                    }
                                                  : {}),
                                          });
                            if (preparedAction.kind === 'clarification') {
                                assistantReply = preparedAction.message;
                            } else if (
                                'proposal' in preparedAction ||
                                'proposalId' in preparedAction
                            ) {
                                const proposal =
                                    'proposal' in preparedAction
                                        ? preparedAction.proposal
                                        : 'proposalId' in preparedAction
                                          ? {
                                                id: preparedAction.proposalId,
                                                payload: preparedAction.payload,
                                                expiresAt:
                                                    preparedAction.expiresAt,
                                            }
                                          : null;
                                if (!proposal)
                                    throw new Error(
                                        'Proposal action không hợp lệ.',
                                    );
                                actionProposalMetadata = {
                                    proposalId: proposal.id,
                                    batchId:
                                        'batchId' in preparedAction
                                            ? preparedAction.batchId
                                            : proposal.id,
                                    payload: proposal.payload,
                                    expiresAt: proposal.expiresAt.toISOString(),
                                };
                                actionProposalsMetadata = [
                                    {
                                        ...actionProposalMetadata,
                                        batchId:
                                            actionProposalMetadata.batchId ??
                                            proposal.id,
                                    },
                                ];
                                assistantReply =
                                    'Mình đã chuẩn bị bản xem trước. Kiểm tra thông tin rồi xác nhận để áp dụng.';
                                yield {
                                    type: 'action_batch_proposed',
                                    batchId:
                                        actionProposalMetadata.batchId ??
                                        proposal.id,
                                    proposals: actionProposalsMetadata,
                                };
                                if (proposal.payload.kind === 'SET_INVENTORY') {
                                    // Giữ event cũ cho client đã triển khai trước batch contract; UI mới ưu tiên actionProposals.
                                    yield {
                                        type: 'action_proposed',
                                        proposalId: proposal.id,
                                        action: {
                                            kind: 'SET_INVENTORY',
                                            productId:
                                                proposal.payload.productId,
                                            productName:
                                                proposal.payload.productName,
                                            variantId:
                                                proposal.payload.variantId,
                                            variantName:
                                                proposal.payload.variantName,
                                            currentAvailable:
                                                proposal.payload
                                                    .expectedAvailable,
                                            nextAvailable:
                                                proposal.payload.nextAvailable,
                                        },
                                        expiresAt:
                                            proposal.expiresAt.toISOString(),
                                    };
                                }
                            } else {
                                actionProposalsMetadata =
                                    preparedAction.proposals.map(
                                        (proposal) => ({
                                            proposalId: proposal.id,
                                            batchId: preparedAction.batchId,
                                            payload: proposal.payload,
                                            expiresAt:
                                                proposal.expiresAt.toISOString(),
                                        }),
                                    );
                                const skippedCount =
                                    'skippedCount' in preparedAction
                                        ? preparedAction.skippedCount
                                        : 0;
                                const skippedVariants =
                                    'skippedVariants' in preparedAction &&
                                    Array.isArray(
                                        preparedAction.skippedVariants,
                                    )
                                        ? preparedAction.skippedVariants
                                        : [];
                                const skippedMessage = skippedVariants.length
                                    ? ` Đã bỏ qua: ${skippedVariants
                                          .map(
                                              ({ name, reason }) =>
                                                  `${name}: ${reason}`,
                                          )
                                          .join(' · ')}`
                                    : '';
                                assistantReply = `Mình đã chuẩn bị ${actionProposalsMetadata.length} đề xuất${skippedCount ? `; ${skippedCount} dòng vượt giới hạn lưu kho nên chưa có đề xuất` : ''}.${skippedMessage} Chọn từng dòng hoặc xác nhận các dòng bạn đã chọn.`;
                                yield {
                                    type: 'action_batch_proposed',
                                    batchId: preparedAction.batchId,
                                    proposals: actionProposalsMetadata,
                                };
                            }
                        }
                    }
                    if (readAnswerReply) {
                        const actionReply = assistantReply;
                        const separator = '\n\n';
                        assistantReply = `${readAnswerReply}${separator}${actionReply}`;
                        if (readAnswerStreamed) {
                            // Phần câu trả lời live đã stream xong; nối hướng dẫn preview thành delta cuối để khớp nội dung lưu history.
                            yield {
                                type: 'token',
                                text: `${separator}${actionReply}`,
                            };
                        }
                    }
                }
            } else if (answerTasks.length) {
                // Đọc và mutation dùng cùng pipeline đã xác thực domain; policy của mode quyết định nguồn có được phép gọi hay không.
                const readResult = yield* this.answerReadTasks({
                    preparedChat,
                    request,
                    interactionMode,
                    plan,
                    answerTasks,
                    history,
                    shopDataPresentation,
                    initialReply: assistantReply,
                    requestId,
                    signal,
                });
                assistantReply = readResult.assistantReply;
                citations = readResult.citations;
                dataSources = readResult.dataSources;
                insights = readResult.insights;
                answerStatus = readResult.answerStatus;
                answerStatusReason = readResult.answerStatusReason;
                assistantResponseStreamed =
                    readResult.assistantResponseStreamed;
            }
        }
        // Kiểm tra lần cuối sát điểm ghi để tránh lưu assistant nếu client vừa hủy trong lúc dựng phản hồi.
        signal?.throwIfAborted();

        // Lưu đúng nội dung sẽ phát để refresh/reconnect hiển thị nhất quán; không lưu plan hay output phân loại vào hội thoại.
        await this.repository.saveMessage({
            conversationId: preparedChat.conversationId,
            role: 'assistant',
            content: assistantReply,
            metadata: {
                ...(citations.length ? { citations } : {}),
                ...(dataSources.length ? { dataSources } : {}),
                ...(insights.length ? { insights } : {}),
                ...(answerStatus ? { answerStatus } : {}),
                ...(answerStatusReason ? { answerStatusReason } : {}),
                interactionMode,
                modeSessionId: preparedChat.modeSessionId,
                ...(actionProposalMetadata
                    ? { actionProposal: actionProposalMetadata }
                    : {}),
                ...(actionProposalsMetadata?.length
                    ? { actionProposals: actionProposalsMetadata }
                    : {}),
            },
        });

        // === BƯỚC 3: Phát event SSE theo contract hiện tại ===
        // Phát nội dung đã chọn từ plan để client hiển thị; token ở đây là một chunk hoàn chỉnh, không phải token model.
        // Các nhánh không gọi answer model vẫn phản hồi qua cùng contract token, còn answer stream đã phát delta ở phía trên.
        if (answerStatus) {
            // Chỉ trạng thái abstain/lỗi được phát; câu trả lời bình thường không cần thêm event trạng thái cuối.
            yield { type: 'answer_status', status: answerStatus };
        }
        if (!assistantResponseStreamed && assistantReply) {
            // Các nhánh direct/fallback không có delta dùng một token hoàn chỉnh; tránh lặp câu khi adapter đã stream nội dung.
            yield { type: 'token', text: assistantReply };
        }

        // Phát event done để client biết đã hoàn tất; client có thể dọn dẹp trạng thái loading.
        yield {
            type: 'done',
            dataAsOf: new Date().toISOString(),
            citations,
            latencyMs: Date.now() - startedAt,
        };
    }

    // Định tuyến, nạp context và tạo câu trả lời cho các task đọc; mutation không bao giờ đi qua helper này.
    // Tài liệu trong Agent được trả về thành handoff rõ ràng, còn domain lạ dừng trước mọi I/O để fail closed.
    private async *answerReadTasks(input: {
        preparedChat: PreparedSellerCopilotChat;
        request: SellerCopilotRequest;
        interactionMode: NonNullable<SellerCopilotRequest['interactionMode']>;
        plan: Parameters<typeof routeSellerCopilotTasks>[0]['plan'];
        answerTasks: Parameters<
            typeof routeSellerCopilotTasks
        >[0]['answerTasks'];
        history: ReturnType<typeof buildSellerCopilotQuestionHistory>;
        shopDataPresentation: ReturnType<
            typeof resolveShopDataPresentation
        > | null;
        initialReply: string;
        requestId: string;
        signal?: AbortSignal;
    }): AsyncGenerator<
        SellerCopilotEvent,
        GeneratedSellerCopilotAnswer & { blocked: boolean }
    > {
        const registry =
            input.interactionMode === 'chat'
                ? { domains: [] }
                : await this.registryProvider.getActiveRegistry();
        const domainKinds = new Map(
            registry.domains.map((domain) => [domain.code, domain.kind]),
        );
        const routing = routeSellerCopilotTasks({
            plan: input.plan,
            answerTasks: input.answerTasks,
            domainKinds,
            interactionMode: input.interactionMode,
            originalQuestion: input.request.message,
        });
        const defaultResult = (
            assistantReply: string,
            blocked: boolean,
        ): GeneratedSellerCopilotAnswer & { blocked: boolean } => ({
            assistantReply,
            citations: [],
            dataSources: [],
            insights: [],
            assistantResponseStreamed: false,
            blocked,
        });

        // Knowledge chỉ được đọc trong mode Tài liệu; Agent báo đúng nơi chuyển đến và không trộn task với dữ liệu shop.
        if (
            input.interactionMode === 'agent' &&
            routing.wrongSourceTasks.some(
                (task) => domainKinds.get(task.domain ?? '') === 'knowledge',
            )
        ) {
            return defaultResult(
                'Câu hỏi này cần chính sách hoặc hướng dẫn từ tài liệu. Bạn chuyển sang mode Tài liệu rồi gửi lại nhé.',
                true,
            );
        }

        const knowledgeModeHandoff =
            input.interactionMode === 'knowledge'
                ? resolveKnowledgeModeHandoff(routing.routedTasks, domainKinds)
                : null;
        if (knowledgeModeHandoff) {
            return defaultResult(knowledgeModeHandoff, true);
        }
        if (routing.unresolvedTasks.length || routing.wrongSourceTasks.length) {
            return defaultResult(COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE, true);
        }

        // Context loader chỉ nhận task đã route, và tự giới hạn mọi truy vấn theo tenant đã xác thực ở preparedChat.
        const loadedContext = yield* this.contextLoader.load({
            preparedChat: input.preparedChat,
            request: input.request,
            interactionMode: input.interactionMode,
            answerTasks: input.answerTasks,
            routing,
            shopDataPresentation: input.shopDataPresentation,
            requestId: input.requestId,
            signal: input.signal,
        });
        let initialReply = input.initialReply;
        if (loadedContext.contextData.rangeClarification) {
            // Không âm thầm dùng kỳ mặc định nếu người bán nêu khoảng thời gian backend chưa hỗ trợ.
            initialReply =
                'Bạn cho mình biết tháng/năm cần xem hoặc chọn 7, 30, 90 ngày gần nhất nhé. Mình sẽ đối chiếu đúng kỳ bạn muốn.';
        }

        return {
            ...(yield* this.answerGenerator.generate({
                preparedChat: input.preparedChat,
                request: input.request,
                interactionMode: input.interactionMode,
                answerTasks: input.answerTasks,
                initialReply,
                history: input.history,
                context: loadedContext,
                shopDataPresentation: input.shopDataPresentation,
                requestId: input.requestId,
                signal: input.signal,
            })),
            blocked: false,
        };
    }
}

// @ command cho phép người bán chọn đúng luồng; câu tự nhiên chỉ được nhận khi có mẫu ý định và dữ liệu cần thiết rõ ràng.
function detectAgentAction(
    message: string,
): 'low_stock' | 'inventory' | 'price' | 'content' | 'slow_moving_price' | null {
    const normalized = message.normalize('NFC').trim().toLocaleLowerCase('vi');
    const command = normalized.match(
        /^@(tồn-kho|ton-kho|giá|xả-hàng|xa-hang)(?![\p{L}\p{N}_-])/u,
    )?.[1];
    if (command === 'xả-hàng' || command === 'xa-hang') {
        return 'slow_moving_price';
    }
    if (command === 'giá') return 'price';
    if (command === 'tồn-kho' || command === 'ton-kho') {
        // Có @tồn-kho thì động từ thay đổi luôn đi vào luồng chỉnh một target;
        // sau khi chọn biến thể, “lên N” cũng là target rõ dù không lặp động từ.
        // Chỉ câu không có động từ hoặc mức đích mới được hiểu là rà toàn bộ hàng sắp hết.
        return /(?:tăng|giảm|đặt|cập nhật|chỉnh)(?=\s)/u.test(normalized) ||
            /(?:^|\s)(?:lên|về|thành|xuống|bằng)\s*\d+\s*[.!?]*$/u.test(
                normalized,
            )
            ? 'inventory'
            : 'low_stock';
    }
    if (
        /(?:đổi|chỉnh|cập nhật) giá/u.test(normalized) &&
        /(?:sku|thành|là)\b/u.test(normalized)
    )
        return 'price';
    if (/(?:đổi|sửa|cập nhật) (?:tên|mô tả)/u.test(normalized))
        return 'content';
    if (/(?:sắp hết hàng|tồn kho thấp|bổ sung hàng)/u.test(normalized))
        return 'low_stock';
    if (
        /(?:xả hàng|hàng tồn lâu|bán chậm|tồn kho.*(?:bán chậm|ít bán))/u.test(
            normalized,
        )
    ) {
        return 'slow_moving_price';
    }
    return null;
}
