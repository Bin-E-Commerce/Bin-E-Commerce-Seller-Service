// Điều phối chat Seller Copilot từ xác thực tenant tới phân loại, truy xuất, tạo câu trả lời và lưu citation.
// Use case không truy vấn database trực tiếp; scope tenant và persistence luôn đi qua các service/port tương ứng.
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import { buildSellerCopilotQuestionHistory } from '@/modules/seller-copilot/application/conversation/history/build-seller-copilot-question-history.util';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/shared/planner/seller-question-understanding.service';
import { buildSellerCopilotConversationTitle } from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';
import type {
    SellerCopilotEvent,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/shared/context/seller-question-context.util';
import { resolveSellerCopilotRange } from '@/modules/seller-copilot/application/conversation/utils/resolve-seller-copilot-range.util';
import {
    SELLER_COPILOT_ANSWER,
    type SellerCopilotAnswerPort,
} from '@/modules/seller-copilot/application/answer/shared/ports/seller-copilot-answer.port';
import { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';
import type {
    SellerKnowledgeCitation,
    SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import { AuthUserClient } from '@/modules/shop-profile/application/clients/auth-user.client';
import { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import { buildSellerCopilotInsights } from '@/modules/seller-copilot/application/answer/modes/shop-data/insights/build-seller-copilot-insights.util';
import { buildShopDataAnswerContext } from '@/modules/seller-copilot/application/answer/modes/shop-data/context/build-shop-data-context.util';
import { resolveShopDataPresentation } from '@/modules/seller-copilot/application/answer/modes/shop-data/presentation/resolve-shop-data-presentation.util';
import { resolveProductDetailFollowUp } from '@/modules/seller-copilot/application/answer/modes/shop-data/follow-ups/resolve-product-detail-follow-up.util';
import {
    mapSellerCopilotCitations,
    selectSellerCopilotEvidence,
} from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-evidence.util';
import {
    resolveChatModeHandoff,
    resolveKnowledgeModeHandoff,
} from '@/modules/seller-copilot/application/answer/modes/chat/resolve-chat-mode-handoff.util';
import {
    buildSellerCopilotInitialReply,
    logSellerCopilotAbstention,
    logSellerCopilotPlanSummary,
} from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-plan.util';
import { routeSellerCopilotTasks } from '@/modules/seller-copilot/application/answer/shared/utils/route-seller-copilot-tasks.util';
import type {
    SellerCopilotDataSourceType,
    SellerCopilotInsight,
    SellerCopilotVisualizationType,
} from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import {
    SELLER_QUESTION_CAPABILITY_REGISTRY,
    type SellerQuestionCapabilityRegistryProvider,
} from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';

// Scope tenant và conversation đã được xác minh trước khi controller gửi SSE headers.
export interface PreparedSellerCopilotChat {
    ownerUserId: string;
    ownerEmail: string;
    ownerPermissions: string[];
    shopId: string;
    conversationId: string;
    modeSessionId: string;
    shopProfile: {
        name: string;
        slug: string;
        description: string | null;
        businessModel: string;
        status: string;
        logoUrl?: string | null;
        contactEmail: string;
        contactPhone: string;
    };
}

const COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE =
    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂';
const COPILOT_NO_PUBLISHED_KNOWLEDGE_MESSAGE =
    'Hiện tại mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này. Bạn có thể liên hệ quản trị viên của shop để được hỗ trợ thêm nhé 🙂.';
const COPILOT_ACTION_NOT_SUPPORTED_MESSAGE =
    'Mình có thể tra cứu chính sách và hướng dẫn đã xuất bản, nhưng hiện chưa thể thay đổi dữ liệu hoặc thực hiện thao tác thay bạn.';
const COPILOT_ANSWER_FAILED_MESSAGE =
    'Mình chưa thể xác minh câu trả lời từ tài liệu lúc này. Bạn thử gửi lại câu hỏi sau nhé.';
const QUESTION_HISTORY_FETCH_LIMIT = 16;
const VISUALIZATION_DOMAIN: Record<SellerCopilotVisualizationType, string> = {
    revenue_trend: 'seller-revenue',
    top_products: 'seller-products-inventory',
    sold_products: 'seller-products-inventory',
    products_without_revenue: 'seller-products-inventory',
    product_catalog: 'seller-products-inventory',
    low_stock: 'seller-products-inventory',
    out_of_stock: 'seller-products-inventory',
    stock_summary: 'seller-products-inventory',
    seller_profile: 'seller-profile',
    order_details: 'seller-orders',
    completed_orders: 'seller-orders',
    completed_order_list: 'seller-orders',
    return_orders: 'seller-orders',
    actionable_orders: 'seller-orders',
    cancelled_orders: 'seller-orders',
    delivered_orders: 'seller-orders',
};

// Điều phối một lượt chat: xác thực tenant, nạp lịch sử an toàn, phân loại, truy xuất evidence và phát SSE có citation.
// Use case không truy vấn persistence trực tiếp; mọi message, knowledge và answer đều đi qua service/port ứng dụng.
@Injectable()
// Orchestrator giữ thứ tự tenant → planner → retrieval → answer → persistence cho một lượt chat.
export class StreamSellerCopilotUseCase {
    private readonly logger = new Logger(StreamSellerCopilotUseCase.name);

    // Các dependency là application services/ports để use case không phụ thuộc HTTP client hoặc ORM.
    constructor(
        private readonly access: SellerCopilotAccessService,
        private readonly understanding: SellerQuestionUnderstandingService,
        private readonly knowledgeRetrieval: SellerKnowledgeRetrievalService,
        private readonly dashboard: SellerDashboardService,
        private readonly authUser: AuthUserClient,
        private readonly inventoryAgent: SellerInventoryAgentService,
        @Inject(SELLER_QUESTION_CAPABILITY_REGISTRY)
        private readonly registryProvider: SellerQuestionCapabilityRegistryProvider,
        @Inject(SELLER_COPILOT_ANSWER)
        private readonly answerClient: SellerCopilotAnswerPort,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
        private readonly modeSessions: ConversationModeSessionService,
    ) {}

    // Xác thực tenant và kiểm tra conversation trước khi mở SSE để lỗi quyền/ID sai vẫn giữ HTTP status chuẩn.
    // Trả về đúng scope đã xác minh để execute không truy vấn shop lần hai và không tin shopId từ request.
    async prepare(
        ownerUserId: string | undefined,
        request: SellerCopilotRequest,
        userContext: { email?: string; permissions?: string[] } = {},
    ): Promise<PreparedSellerCopilotChat> {
        const shop = await this.access.resolveActiveShop(ownerUserId);

        const conversation = await this.getOrCreateConversation(
            shop.ownerUserId,
            shop.id,
            request.conversationId,
            request.message,
        );
        // Gắn request vào phiên mode thuộc conversation đã xác thực; session ID từ client chỉ được dùng sau khi service kiểm tra.
        // Nhờ vậy history ở execute có thể bị chặn tại ranh giới đổi mode, kể cả khi người dùng mở lại conversation cũ.
        const modeSession = await this.modeSessions.resolveForChat({
            conversationId: conversation.id,
            interactionMode: request.interactionMode ?? 'chat',
            requestedModeSessionId: request.modeSessionId,
        });

        return {
            ownerUserId: shop.ownerUserId,
            ownerEmail: userContext.email ?? '',
            ownerPermissions: userContext.permissions ?? [],
            shopId: shop.id,
            conversationId: conversation.id,
            modeSessionId: modeSession.modeSessionId,
            shopProfile: {
                name: shop.name,
                logoUrl: shop.logoUrl,
                slug: shop.slug,
                description: shop.description,
                businessModel: shop.businessModel,
                status: shop.status,
                contactEmail: shop.contactEmail,
                contactPhone: shop.contactPhone,
            },
        };
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
        const plan =
            interactionMode === 'shop_data'
                ? resolveProductDetailFollowUp({
                      plan: generatedPlan,
                      recentMessages,
                      modeSessionId: preparedChat.modeSessionId,
                  })
                : generatedPlan;

        // Provider có thể trả kết quả đúng lúc browser vừa bấm Dừng; không ghi thêm câu trả lời cho lượt đã hủy.
        signal?.throwIfAborted();

        if (interactionMode === 'knowledge' || interactionMode === 'agent') {
            logSellerCopilotPlanSummary(this.logger, plan);
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
        let citations: SellerKnowledgeCitation[] = [];
        let dataSources: Array<{
            kind: 'shop_data' | 'live_data' | 'seller_profile';
            label: string;
        }> = [];
        let insights: SellerCopilotInsight[] = [];
        let answerStatus: 'unsupported' | 'provider_error' | undefined;
        let answerStatusReason:
            | 'no_retrieval_results'
            | 'insufficient_evidence'
            | 'provider_error'
            | undefined;
        let assistantResponseStreamed = false;
        let actionProposalMetadata:
            | NonNullable<
                  Parameters<
                      SellerCopilotRepositoryPort['saveMessage']
                  >[0]['metadata']
              >['actionProposal']
            | undefined;
        if (plan.status === 'READY' && !chatModeHandoff) {
            // Mutation được xét riêng trước các task đọc để một request hỗn hợp không vô tình chạy phần ghi như truy vấn thường.
            const hasMutationRequest = plan.tasks.some(
                (task) => task.requestType === 'CHANGE_REQUEST',
            );
            const rawAnswerTasks = plan.tasks.filter(
                (task) =>
                    task.requestType === 'READ_QUERY' ||
                    task.requestType === 'CAPABILITY_QUERY' ||
                    task.requestType === 'SMALL_TALK',
            );
            const shopDataPresentation =
                interactionMode === 'shop_data'
                    ? resolveShopDataPresentation({
                          tasks: rawAnswerTasks,
                      })
                    : null;
            const answerTasks = shopDataPresentation?.tasks ?? rawAnswerTasks;

            // Mọi write phải đến từ agent mode và domain allowlist; chat thường không được biến lời nói thành lệnh.
            if (hasMutationRequest) {
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
                    inventoryChanges.length !== 1
                ) {
                    // Chỉ một mutation tồn kho duy nhất, agent mode và domain đang bật live-data mới qua được chốt này.
                    assistantReply = COPILOT_ACTION_NOT_SUPPORTED_MESSAGE;
                } else {
                    yield {
                        type: 'status',
                        phase: 'action_preview',
                        message:
                            'Đang tìm sản phẩm và chuẩn bị thay đổi tồn kho…',
                    };
                    const preparedAction = await this.inventoryAgent.prepare({
                        ownerUserId: preparedChat.ownerUserId,
                        shopId: preparedChat.shopId,
                        conversationId: preparedChat.conversationId,
                        message: request.message,
                    });
                    if (preparedAction.kind === 'clarification') {
                        // Thiếu SKU/số lượng hoặc target không duy nhất: trả câu hỏi làm rõ, không lưu proposal để tránh xác nhận sai.
                        assistantReply = preparedAction.message;
                    } else {
                        // Proposal là preview bất biến có hạn dùng; client chỉ nhận dữ liệu cần hiển thị và ID opaque để xác nhận sau.
                        const { proposalId, payload, expiresAt } =
                            preparedAction;
                        actionProposalMetadata = {
                            proposalId,
                            payload,
                            expiresAt: expiresAt.toISOString(),
                        };
                        assistantReply =
                            'Mình đã chuẩn bị thay đổi tồn kho. Kiểm tra thông tin bên dưới rồi xác nhận để áp dụng.';
                        yield {
                            type: 'action_proposed',
                            proposalId,
                            action: {
                                kind: 'SET_INVENTORY',
                                productId: payload.productId,
                                productName: payload.productName,
                                variantId: payload.variantId,
                                variantName: payload.variantName,
                                currentAvailable: payload.expectedAvailable,
                                nextAvailable: payload.nextAvailable,
                            },
                            expiresAt: expiresAt.toISOString(),
                        };
                    }
                }
            } else if (interactionMode === 'agent') {
                // Agent chỉ hỗ trợ mutation tồn kho; truy vấn đọc trong mode này không được âm thầm chạy như chat/knowledge.
                assistantReply = COPILOT_ACTION_NOT_SUPPORTED_MESSAGE;
            } else if (answerTasks.length) {
                // Task Chat bình thường là SMALL_TALK; mọi task nghiệp vụ đã bị chặn ở handoff trước khi đến bước này.
                const registry =
                    interactionMode === 'chat'
                        ? { domains: [] }
                        : await this.registryProvider.getActiveRegistry();
                const domainKinds = new Map(
                    registry.domains.map((domain) => [
                        domain.code,
                        domain.kind,
                    ]),
                );
                // Route helper gom task theo capability đã đăng ký; domain không có trong registry sẽ bị fail-closed.
                const routing = routeSellerCopilotTasks({
                    plan,
                    answerTasks,
                    domainKinds,
                    interactionMode,
                    originalQuestion: request.message,
                });
                const {
                    hasProductQuestion,
                    hasOrderQuestion,
                    hasProfileQuestion,
                    knowledgeTasks,
                    originalQuestion,
                    canRetryWithOriginalQuestion,
                    liveTasks,
                    profileTasks,
                    unresolvedTasks,
                    wrongSourceTasks,
                } = routing;
                let originalQuestionWasRetried = false;

                // Registry là nguồn chân thật cho loại nguồn; domain lạ dừng an toàn thay vì rơi mặc định vào Qdrant.
                const knowledgeModeHandoff =
                    interactionMode === 'knowledge'
                        ? resolveKnowledgeModeHandoff(
                              routing.routedTasks,
                              domainKinds,
                          )
                        : null;
                if (knowledgeModeHandoff) {
                    // Không trả fallback “chưa có tài liệu” cho câu đã nhận diện là dữ liệu shop; hướng người bán sang đúng mode.
                    assistantReply = knowledgeModeHandoff;
                } else if (unresolvedTasks.length || wrongSourceTasks.length) {
                    // Domain lạ hoặc mode Knowledge trỏ nhầm nguồn phải dừng trước khi gọi bất kỳ nguồn dữ liệu nào.
                    assistantReply = COPILOT_TEMPORARILY_UNAVAILABLE_MESSAGE;
                } else {
                    const evidenceGroups: SellerKnowledgeSearchHit[][] = [];
                    const contextData: Record<string, unknown> = {};
                    const dashboardRange = resolveSellerCopilotRange(
                        [
                            request.message,
                            ...answerTasks.map((task) => task.resolvedQuestion),
                        ].join(' '),
                        request.range,
                    );
                    if (
                        interactionMode === 'shop_data' &&
                        liveTasks.length > 0 &&
                        dashboardRange === null
                    ) {
                        // Không thay kỳ không hỗ trợ bằng 30 ngày mặc định; nếu làm vậy câu trả lời có thể đúng số nhưng sai ý định.
                        assistantReply =
                            'Bạn cho mình biết tháng/năm cần xem hoặc chọn 7, 30, 90 ngày gần nhất nhé. Mình sẽ đối chiếu đúng kỳ bạn muốn.';
                        contextData.rangeClarification = true;
                    }
                    const needsProductCatalog =
                        shopDataPresentation?.productPresentations.some(
                            (presentation) =>
                                presentation === 'catalog' ||
                                presentation === 'detail' ||
                                presentation === 'low-stock' ||
                                presentation === 'no-revenue-list',
                        ) ?? false;
                    let shopSnapshot:
                        | Awaited<
                              ReturnType<SellerDashboardService['getOverview']>
                          >
                        | undefined;
                    let productCatalog:
                        | Awaited<
                              ReturnType<
                                  SellerInventoryAgentService['getProductCatalog']
                              >
                          >
                        | undefined;
                    let accountProfile:
                        | Awaited<
                              ReturnType<AuthUserClient['getCopilotProfile']>
                          >
                        | undefined;

                    // Chỉ nạp nguồn planner đã chọn; Promise.allSettled vẫn cho phép trả lời từ một nguồn nếu nguồn còn lại trong câu nhiều ý bị lỗi.
                    if (
                        interactionMode === 'shop_data' &&
                        (liveTasks.length > 0 || hasProfileQuestion) &&
                        (!liveTasks.length || dashboardRange !== null)
                    ) {
                        yield {
                            type: 'status',
                            phase: 'live_data',
                            message: 'Đang tải hồ sơ và dữ liệu shop…',
                        };
                        const [
                            dashboardResult,
                            profileResult,
                            productCatalogResult,
                        ] = await Promise.allSettled([
                            liveTasks.length && dashboardRange
                                ? this.dashboard.getOverview(
                                      preparedChat.ownerUserId,
                                      dashboardRange,
                                  )
                                : Promise.resolve(undefined),
                            hasProfileQuestion
                                ? this.authUser.getCopilotProfile(
                                      preparedChat.ownerUserId,
                                  )
                                : Promise.resolve(undefined),
                            needsProductCatalog
                                ? this.inventoryAgent.getProductCatalog(
                                      preparedChat.shopId,
                                      preparedChat.ownerUserId,
                                  )
                                : Promise.resolve(undefined),
                        ]);
                        if (dashboardResult.status === 'fulfilled') {
                            // Nguồn bị bỏ qua có giá trị undefined; chỉ snapshot thật mới được đưa vào context live.
                            shopSnapshot = dashboardResult.value;
                        } else {
                            contextData.unavailableSources = [
                                'Dữ liệu live của shop',
                            ];
                        }

                        if (
                            productCatalogResult.status === 'fulfilled' &&
                            productCatalogResult.value
                        ) {
                            // Catalog chỉ được nạp khi planner chọn seller-products-inventory; request chạy song song với dashboard/profile.
                            productCatalog = productCatalogResult.value;
                            // Follow-up “sản phẩm này” chỉ trả đúng ID lấy từ insight backend; không để catalog card bung cả danh sách.
                            const referencedProductId = answerTasks.find(
                                (task) => task.productId,
                            )?.productId;
                            if (referencedProductId) {
                                const referencedProducts =
                                    productCatalog.items.filter(
                                        (product) =>
                                            product.productId ===
                                            referencedProductId,
                                    );
                                productCatalog = {
                                    ...productCatalog,
                                    items: referencedProducts,
                                    totalCount: referencedProducts.length,
                                    hasMore: false,
                                };
                            }
                            // Catalog chỉ vào prompt cho câu hỏi danh sách/chi tiết/tồn thấp; count và doanh số dùng aggregate riêng.
                            contextData.productCatalog = productCatalog;
                            if (shopSnapshot) {
                                const thumbnailByProductId = new Map(
                                    productCatalog.items.map((product) => [
                                        product.productId,
                                        product.thumbnailUrl,
                                    ]),
                                );
                                shopSnapshot = {
                                    ...shopSnapshot,
                                    topProducts: shopSnapshot.topProducts.map(
                                        (product) => ({
                                            ...product,
                                            thumbnailUrl:
                                                product.thumbnailUrl ??
                                                thumbnailByProductId.get(
                                                    product.productId,
                                                ) ??
                                                null,
                                        }),
                                    ),
                                };
                            }
                        } else if (needsProductCatalog) {
                            // Thiếu catalog thì không giả làm danh sách đầy đủ; các nguồn khác trong câu nhiều ý vẫn có thể trả lời.
                            contextData.unavailableSources = [
                                ...((contextData.unavailableSources as
                                    string[] | undefined) ?? []),
                                'Danh sách sản phẩm và phân loại',
                            ];
                        }
                        if (profileResult.status === 'fulfilled') {
                            // Profile có thể undefined khi planner không route tới seller-profile; không nạp thông tin cá nhân ngoài ý hỏi.
                            accountProfile = profileResult.value;
                        } else {
                            contextData.unavailableSources = [
                                ...((contextData.unavailableSources as
                                    string[] | undefined) ?? []),
                                'Hồ sơ tài khoản/shop',
                            ];
                        }
                    }

                    if (knowledgeTasks.length) {
                        // Song song hóa retrieval theo từng task; evidenceGroups giữ biên task để bước hợp nhất phân bổ cơ hội cho mỗi ý.
                        yield {
                            type: 'status',
                            phase: 'retrieval',
                            message: 'Đang tìm trong tài liệu đã xuất bản…',
                        };
                        // Chỉ task domain kind=knowledge được gọi Qdrant; lịch sử không đi vào retrieval như evidence.
                        const retrieved = await Promise.all(
                            knowledgeTasks.map(async (task) => {
                                const primaryEvidence =
                                    await this.knowledgeRetrieval.retrieve({
                                        query: task.resolvedQuestion,
                                        domainCodes: task.domain
                                            ? [task.domain]
                                            : [],
                                        signal,
                                    });

                                // Chỉ câu hỏi chủ đề mới, một ý rõ ràng mới được thử lại bằng nguyên văn người dùng.
                                // Với follow-up, nguyên văn có thể chỉ là đại từ (“còn cái đó?”), nên không dùng làm truy vấn dự phòng.
                                if (
                                    primaryEvidence.length ||
                                    !canRetryWithOriginalQuestion ||
                                    !originalQuestion ||
                                    task.resolvedQuestion.trim() ===
                                        originalQuestion
                                ) {
                                    return primaryEvidence;
                                }

                                const fallbackEvidence =
                                    await this.knowledgeRetrieval.retrieve({
                                        query: originalQuestion,
                                        domainCodes: task.domain
                                            ? [task.domain]
                                            : [],
                                        signal,
                                    });
                                originalQuestionWasRetried = true;
                                this.logger.log(
                                    JSON.stringify({
                                        event: 'seller_knowledge_original_query_fallback',
                                        requestId,
                                        domain: task.domain,
                                        resultCount: fallbackEvidence.length,
                                    }),
                                );
                                return fallbackEvidence;
                            }),
                        );
                        evidenceGroups.push(...retrieved);
                    }

                    if (
                        liveTasks.length &&
                        (interactionMode !== 'shop_data' || shopSnapshot)
                    ) {
                        // Với Shop Data dùng snapshot đã tải cùng profile; các mode khác chỉ gọi dashboard khi planner yêu cầu live domain.
                        yield {
                            type: 'status',
                            phase: 'live_data',
                            message: 'Đang tải số liệu mới nhất của shop…',
                        };
                        // Dashboard tự resolve shop từ owner đã xác thực; chỉ đưa các trường cần thiết vào context model.
                        const snapshot =
                            shopSnapshot ??
                            (await this.dashboard.getOverview(
                                preparedChat.ownerUserId,
                                dashboardRange ?? '30d',
                            ));
                        contextData.liveData = buildShopDataAnswerContext(
                            snapshot,
                            {
                                revenue: answerTasks.some(
                                    (task) => task.domain === 'seller-revenue',
                                ),
                                orders: hasOrderQuestion,
                                products: hasProductQuestion,
                            },
                            shopDataPresentation
                                ? {
                                      tasks: shopDataPresentation.tasks,
                                      orders: shopDataPresentation.orderPresentations,
                                      products:
                                          shopDataPresentation.productPresentations,
                                  }
                                : undefined,
                            productCatalog,
                        );
                        shopSnapshot = snapshot;
                    }

                    if (
                        profileTasks.length &&
                        (interactionMode !== 'shop_data' || accountProfile)
                    ) {
                        // Dùng profile đã nạp song song nếu có; nếu không, chỉ tải khi task phân loại thực sự cần hồ sơ.
                        yield {
                            type: 'status',
                            phase: 'profile',
                            message: 'Đang tải hồ sơ tài khoản và shop…',
                        };
                        // Auth Service chỉ trả allowlist hồ sơ cơ bản; shop lấy từ scope đã xác thực, không tải hồ sơ thuế/ngân hàng.
                        const account =
                            accountProfile ??
                            (await this.authUser.getCopilotProfile(
                                preparedChat.ownerUserId,
                            ));
                        contextData.profile = {
                            account,
                            shop: preparedChat.shopProfile,
                        };
                    }

                    signal?.throwIfAborted();
                    const evidence =
                        selectSellerCopilotEvidence(evidenceGroups);
                    const hasContextData = Boolean(
                        contextData.liveData ||
                        contextData.profile ||
                        contextData.productCatalog,
                    );
                    const hasContextPayload =
                        Object.keys(contextData).length > 0;
                    const hasUnansweredKnowledge =
                        knowledgeTasks.length > 0 && evidence.length === 0;

                    // Truy vấn tài liệu thuần không có hit phải abstain; mixed query vẫn có thể trả phần live/profile đã xác minh.
                    if (contextData.rangeClarification) {
                        // Ưu tiên clarification thời gian; tuyệt đối không rơi tiếp xuống answer với snapshot kỳ mặc định.
                        // Mốc thời gian chưa hỗ trợ đã được hỏi lại; tuyệt đối không lấy snapshot mặc định để trả sai kỳ.
                    } else if (
                        interactionMode === 'shop_data' &&
                        !hasContextData
                    ) {
                        assistantReply =
                            'Mình chưa tải được hồ sơ hoặc dữ liệu live của shop lúc này. Bạn thử lại sau nhé.';
                    } else if (hasUnansweredKnowledge && !hasContextData) {
                        // Khi không có nguồn nào khác làm rõ được câu hỏi, abstain thay vì để model trả lời dựa trên kiến thức nền.
                        assistantReply = COPILOT_NO_PUBLISHED_KNOWLEDGE_MESSAGE;
                        answerStatus = 'unsupported';
                        answerStatusReason = 'no_retrieval_results';
                        // Chỉ log mã nguyên nhân và số lượng evidence; không ghi câu hỏi hay nội dung tài liệu của shop.
                        logSellerCopilotAbstention(
                            this.logger,
                            requestId,
                            answerStatusReason,
                            evidence.length,
                        );
                    } else {
                        yield {
                            type: 'status',
                            phase: 'answer',
                            message: 'Đang tổng hợp câu trả lời…',
                        };

                        const questions = [
                            ...(interactionMode === 'chat'
                                ? [request.message.trim()]
                                : answerTasks.map(
                                      (task) => task.resolvedQuestion,
                                  )),
                            ...(hasUnansweredKnowledge
                                ? [
                                      'Lưu ý: chưa tìm được tài liệu phù hợp cho phần câu hỏi chính sách.',
                                  ]
                                : []),
                        ];
                        // Chỉ truyền task đã chuẩn hóa và evidence/context backend cấp; câu lịch sử không được coi là nguồn xác thực.
                        let streamedAnswer = '';
                        let answerEvidence = evidence;
                        let answerSupported = false;
                        let requestedDataSources: SellerCopilotDataSourceType[] =
                            [];
                        try {
                            const answerContext = buildSellerQuestionContext({
                                question: request.message,
                                history,
                            });
                            for (let attempt = 0; attempt < 2; attempt += 1) {
                                // Retry chỉ được phép sau lần grounding thất bại; stream token đầu tiên sẽ khóa retry để không phát hai câu trả lời nối nhau.
                                // Mỗi lần chỉ phát token từ answer client; adapter hiện tại giữ câu trả lời đến khi grounding được xác nhận.
                                for await (const part of this.answerClient.stream(
                                    {
                                        question: questions.join('\n'),
                                        evidence: answerEvidence,
                                        history: answerContext.history,
                                        interactionMode,
                                        contextData: hasContextPayload
                                            ? JSON.stringify(contextData)
                                            : undefined,
                                        signal,
                                    },
                                )) {
                                    if (part.type === 'delta') {
                                        streamedAnswer += part.text;
                                        assistantResponseStreamed = true;
                                        yield {
                                            type: 'token',
                                            text: part.text,
                                        };
                                        continue;
                                    }
                                    assistantReply = part.answer;
                                    answerSupported = part.supported;
                                    requestedDataSources =
                                        part.sourcesUsed ?? [];
                                }

                                // Không lặp nếu đã grounded, đã thử một lần, không phải câu hỏi mới đơn nghĩa hoặc đã lộ delta.
                                // Retry chỉ thêm evidence bằng nguyên văn câu hỏi trong cùng domain; không đổi route hay nới quyền truy xuất.
                                if (
                                    answerSupported ||
                                    attempt > 0 ||
                                    !canRetryWithOriginalQuestion ||
                                    originalQuestionWasRetried ||
                                    streamedAnswer.trim()
                                ) {
                                    // Các điều kiện này ngăn retry ở follow-up, sau khi đã thử fallback, hoặc sau khi client đã nhận nội dung.
                                    break;
                                }

                                yield {
                                    type: 'status',
                                    phase: 'retrieval',
                                    message:
                                        'Mình đang đối chiếu lại câu hỏi với tài liệu…',
                                };
                                const fallbackEvidence =
                                    await this.knowledgeRetrieval.retrieve({
                                        query: originalQuestion,
                                        domainCodes: knowledgeTasks[0]?.domain
                                            ? [knowledgeTasks[0].domain]
                                            : [],
                                        signal,
                                    });
                                originalQuestionWasRetried = true;
                                const previousPointIds = new Set(
                                    answerEvidence.map((hit) => hit.pointId),
                                );
                                const combinedEvidence =
                                    selectSellerCopilotEvidence([
                                        answerEvidence,
                                        fallbackEvidence,
                                    ]);
                                const addedEvidenceCount =
                                    combinedEvidence.filter(
                                        (hit) =>
                                            !previousPointIds.has(hit.pointId),
                                    ).length;
                                this.logger.log(
                                    JSON.stringify({
                                        event: 'seller_knowledge_grounding_retry',
                                        requestId,
                                        domain: knowledgeTasks[0]?.domain,
                                        resultCount: fallbackEvidence.length,
                                        addedEvidenceCount,
                                    }),
                                );

                                // Nếu kết quả cũ lặp lại hoặc truy vấn gốc không có hit mới thì dừng, tránh gọi answer model lần hai vô ích.
                                if (!addedEvidenceCount) break;
                                // Hợp nhất mới chỉ được gán khi thật sự có hit mới, tránh gọi provider answer lần hai với cùng evidence.
                                answerEvidence = combinedEvidence;
                            }

                            answerStatus =
                                answerSupported || interactionMode === 'chat'
                                    ? undefined
                                    : 'unsupported';
                            // Planner quyết định domain được đọc; lựa chọn visual của model chỉ được chấp nhận trong đúng domain đó.
                            // Với dữ liệu shop, backend chọn một visual theo intent đã route; không để model ghép table/card cùng domain.
                            // Registry vẫn là chốt domain, còn nội dung/số liệu visual chỉ lấy từ snapshot đã tải ở lượt này.
                            const allowedVisualizations =
                                interactionMode === 'shop_data' &&
                                shopDataPresentation
                                    ? shopDataPresentation.visualizationTypes.filter(
                                          (type) =>
                                              answerTasks.some(
                                                  (task) =>
                                                      task.domain ===
                                                      VISUALIZATION_DOMAIN[
                                                          type
                                                      ],
                                              ),
                                      )
                                    : [];
                            insights = answerSupported
                                ? buildSellerCopilotInsights({
                                      visualizationTypes: allowedVisualizations,
                                      dashboard: shopSnapshot,
                                      productCatalog,
                                      account: accountProfile,
                                      shop: preparedChat.shopProfile,
                                  })
                                : [];
                            answerStatusReason =
                                answerSupported || interactionMode === 'chat'
                                    ? undefined
                                    : 'insufficient_evidence';
                            if (
                                !answerSupported &&
                                interactionMode !== 'chat'
                            ) {
                                // Unsupported bao gồm cả không có hit và hit không đủ căn cứ; lý do cụ thể được giữ trong metadata.
                                // Có retrieval hit nhưng cả hai cách evidence đều chưa đủ; không gắn citation và ghi rõ stage abstain.
                                logSellerCopilotAbstention(
                                    this.logger,
                                    requestId,
                                    'insufficient_evidence',
                                    answerEvidence.length,
                                );
                            }

                            // Retrieval hit chưa chứng minh tài liệu trả lời được câu hỏi; chỉ phát citation sau khi answer xác nhận grounding.
                            // Nếu model từ chối vì evidence không phù hợp, citations giữ rỗng để UI không gắn nguồn gây hiểu nhầm.
                            if (answerSupported && answerEvidence.length) {
                                citations =
                                    mapSellerCopilotCitations(answerEvidence);
                                yield { type: 'sources', items: citations };
                            }
                            // Chỉ gắn nguồn model xác nhận đã dùng và backend thực sự cấp cho lần trả lời này.
                            // Nguồn không tải được hoặc chỉ xuất hiện tình cờ trong context không được biến thành provenance.
                            dataSources = [];
                            if (answerSupported) {
                                for (const sourceType of requestedDataSources) {
                                    // Model không thể gắn nhãn cho dashboard nếu context lần này không có snapshot đã tải thành công.
                                    if (
                                        sourceType === 'live_data' &&
                                        contextData.liveData
                                    ) {
                                        dataSources.push({
                                            kind: 'live_data',
                                            label: 'Dữ liệu live của shop',
                                        });
                                        continue;
                                    }

                                    // Tương tự, hồ sơ chỉ được ghi nguồn khi account/shop thực sự có trong payload đã xác thực.
                                    if (
                                        sourceType === 'seller_profile' &&
                                        contextData.profile
                                    ) {
                                        dataSources.push({
                                            kind: 'seller_profile',
                                            label: 'Hồ sơ tài khoản và shop',
                                        });
                                    }
                                }
                            }
                            if (dataSources.length) {
                                yield {
                                    type: 'data_sources',
                                    items: dataSources,
                                };
                            }
                            if (insights.length) {
                                yield { type: 'insight', items: insights };
                            }
                        } catch (error) {
                            if (signal?.aborted) {
                                // Hủy do client là control flow, không biến thành lỗi provider hay phát fallback thay cho câu trả lời đang dở.
                                // Giữ token đã gửi và đánh dấu incomplete; mode/session vẫn phải lưu để history không cắt nhầm phiên.
                                if (streamedAnswer.trim()) {
                                    await this.repository.saveMessage({
                                        conversationId:
                                            preparedChat.conversationId,
                                        role: 'assistant',
                                        content: streamedAnswer,
                                        metadata: {
                                            // Khi request bị hủy trước complete, chỉ giữ citation nếu đã có nguồn được xác nhận ở một luồng hợp lệ.
                                            ...(citations.length
                                                ? { citations }
                                                : {}),
                                            incomplete: true,
                                            interactionMode,
                                            modeSessionId:
                                                preparedChat.modeSessionId,
                                        },
                                    });
                                }
                                signal.throwIfAborted();
                            }
                            this.logger.warn(
                                JSON.stringify({
                                    event: 'seller_copilot_answer_stream_failed',
                                    requestId,
                                    errorType:
                                        error instanceof Error
                                            ? error.name
                                            : 'unknown_error',
                                }),
                            );
                            // Provider lỗi sau khi stream một phần: thay toàn bộ nội dung ở UI và xóa citation/visual chưa được xác nhận.
                            assistantReply = COPILOT_ANSWER_FAILED_MESSAGE;
                            answerStatus = 'provider_error';
                            answerStatusReason = 'provider_error';
                            citations = [];
                            insights = [];
                            assistantResponseStreamed = true;
                            yield { type: 'replace', text: assistantReply };
                            yield {
                                type: 'warning',
                                code: 'ANSWER_PROVIDER_UNAVAILABLE',
                                message:
                                    'Không thể hoàn tất câu trả lời lúc này. Bạn có thể thử lại.',
                            };
                        }
                    }
                }
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
