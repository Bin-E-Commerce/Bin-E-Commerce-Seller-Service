// Tạo câu trả lời từ context/evidence backend, rồi xác nhận citations, nguồn live và visual trước khi phát metadata.
// Service không query shop; tất cả số liệu đầu vào đã được context loader giới hạn theo plan và tenant.
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    SELLER_COPILOT_ANSWER,
    type SellerCopilotAnswerPort,
} from '@/modules/seller-copilot/application/answer/shared/ports/seller-copilot-answer.port';
import {
    SELLER_COPILOT_REPOSITORY,
    type SellerCopilotRepositoryPort,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type {
    SellerCopilotEvent,
    SellerCopilotHistoryMessage,
    SellerCopilotInteractionMode,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/shared/context/seller-question-context.util';
import { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import type { PreparedSellerCopilotChat } from '@/modules/seller-copilot/application/conversation/streaming/types/prepared-seller-copilot-chat.types';
import type { LoadedSellerCopilotContext } from '@/modules/seller-copilot/application/conversation/streaming/types/loaded-seller-copilot-context.types';
import type { SellerCopilotShopDataPresentation } from '@/modules/seller-copilot/application/answer/modes/shop-data/types/seller-copilot-shop-data-presentation.types';
import type { GeneratedSellerCopilotAnswer } from '@/modules/seller-copilot/application/conversation/streaming/types/generated-seller-copilot-answer.types';
import { buildSellerCopilotInsights } from '@/modules/seller-copilot/application/answer/modes/shop-data/insights/build-seller-copilot-insights.util';
import {
    mapSellerCopilotCitations,
    selectSellerCopilotEvidence,
} from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-evidence.util';
import { logSellerCopilotAbstention } from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-plan.util';
import type {
    SellerCopilotDataSourceType,
    SellerCopilotVisualizationType,
} from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Chỉ các visual thuộc domain do planner route mới được chọn để render insight.
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

// Gói toàn bộ input cần cho answer để service không phải đọc state nội bộ của use case.
interface GenerateGroundedSellerAnswerInput {
    preparedChat: PreparedSellerCopilotChat;
    request: SellerCopilotRequest;
    interactionMode: SellerCopilotInteractionMode;
    answerTasks: SellerQuestionTask[];
    initialReply: string;
    history: SellerCopilotHistoryMessage[];
    context: LoadedSellerCopilotContext;
    shopDataPresentation?: SellerCopilotShopDataPresentation | null;
    requestId: string;
    signal?: AbortSignal;
}

// Cô lập call AI, grounding retry và provenance để luồng conversation không phải ôm chi tiết provider.
@Injectable()
export class GenerateGroundedSellerAnswerService {
    private readonly logger = new Logger(
        GenerateGroundedSellerAnswerService.name,
    );

    constructor(
        @Inject(SELLER_COPILOT_ANSWER)
        private readonly answerClient: SellerCopilotAnswerPort,
        private readonly knowledgeRetrieval: SellerKnowledgeRetrievalService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Stream delta theo thứ tự cũ, retry knowledge tối đa một lần và chỉ công nhận nguồn/visual sau grounding.
    // Nếu client hủy, phần answer đã phát được lưu incomplete rồi AbortSignal tiếp tục thoát lên controller.
    // Lỗi provider thay nội dung dở bằng fallback, đồng thời xóa citation/insight chưa đủ điều kiện xác nhận.
    async *generate(
        input: GenerateGroundedSellerAnswerInput,
    ): AsyncGenerator<SellerCopilotEvent, GeneratedSellerCopilotAnswer> {
        const {
            preparedChat,
            request,
            interactionMode,
            answerTasks,
            initialReply,
            history,
            context,
            shopDataPresentation,
            requestId,
            signal,
        } = input;
        const {
            accountProfile,
            contextData,
            evidence,
            hasContextPayload,
            hasUnansweredKnowledge,
            originalQuestionWasRetried,
            productCatalog,
            routing,
            shopSnapshot,
        } = context;
        let assistantReply = initialReply;
        let citations: GeneratedSellerCopilotAnswer['citations'] = [];
        let dataSources: GeneratedSellerCopilotAnswer['dataSources'] = [];
        let insights: GeneratedSellerCopilotAnswer['insights'] = [];
        let answerStatus: GeneratedSellerCopilotAnswer['answerStatus'];
        let answerStatusReason: GeneratedSellerCopilotAnswer['answerStatusReason'];
        let assistantResponseStreamed = false;
        const readsShopData =
            interactionMode === 'shop_data' || interactionMode === 'agent';

        // Không gọi model khi không có nguồn shop cần thiết hoặc knowledge-only không có tài liệu làm căn cứ.
        if (contextData.rangeClarification) {
            // Use case đã chuẩn bị câu hỏi làm rõ; không được gọi model bằng một range mặc định.
        } else if (readsShopData && !context.hasContextData) {
            // Lỗi nguồn khác với catalog/range rỗng; không gọi model để model suy diễn thành số 0 hay “không có dữ liệu”.
            const unavailableSources = contextData.unavailableSources as
                string[] | undefined;
            assistantReply = unavailableSources?.length
                ? `Mình chưa tải được ${unavailableSources.join(', ')} lúc này nên chưa thể xác minh dữ liệu shop. Bạn thử lại sau nhé.`
                : 'Mình chưa tải được hồ sơ hoặc dữ liệu live của shop lúc này. Bạn thử lại sau nhé.';
            answerStatus = 'source_unavailable';
            answerStatusReason = 'source_unavailable';
        } else if (hasUnansweredKnowledge && !context.hasContextData) {
            assistantReply =
                'Hiện tại mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này. Bạn có thể liên hệ quản trị viên của shop để được hỗ trợ thêm nhé 🙂.';
            answerStatus = 'unsupported';
            answerStatusReason = 'no_retrieval_results';
            // Log mã nguyên nhân và số hit, không ghi câu hỏi hay nội dung nội bộ của tài liệu shop.
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

            // Knowledge tasks được trả lời theo câu đã chuẩn hóa; Chat giữ nguyên câu người dùng.
            const questions = [
                ...(interactionMode === 'chat'
                    ? [request.message.trim()]
                    : answerTasks.map((task) => task.resolvedQuestion)),
                ...(hasUnansweredKnowledge
                    ? [
                          'Lưu ý: chưa tìm được tài liệu phù hợp cho phần câu hỏi chính sách.',
                      ]
                    : []),
            ];
            let streamedAnswer = '';
            let answerEvidence = evidence;
            let answerSupported = false;
            let requestedDataSources: SellerCopilotDataSourceType[] = [];

            try {
                const answerContext = buildSellerQuestionContext({
                    question: request.message,
                    history,
                });
                // Giữ nguyên history đã được lọc theo mode từ context loader; không dùng nội dung answer cũ làm evidence.
                const safeAnswerHistory = answerContext.history;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    // Retry chỉ được xem xét sau grounding; nếu đã phát delta thì không thể khởi động câu trả lời thứ hai.
                    for await (const part of this.answerClient.stream({
                        question: questions.join('\n'),
                        evidence: answerEvidence,
                        history: safeAnswerHistory,
                        interactionMode,
                        contextData: hasContextPayload
                            ? JSON.stringify(contextData)
                            : undefined,
                        signal,
                    })) {
                        if (part.type === 'delta') {
                            streamedAnswer += part.text;
                            assistantResponseStreamed = true;
                            yield { type: 'token', text: part.text };
                            continue;
                        }
                        assistantReply = part.answer;
                        answerSupported = part.supported;
                        requestedDataSources = part.sourcesUsed ?? [];
                    }

                    // Một lần retry tối đa, chỉ cho câu topic mới và trước token đầu để tránh ghép hai answer stream.
                    if (
                        answerSupported ||
                        attempt > 0 ||
                        !routing.canRetryWithOriginalQuestion ||
                        originalQuestionWasRetried ||
                        streamedAnswer.trim()
                    ) {
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
                            query: routing.originalQuestion,
                            domainCodes: routing.knowledgeTasks[0]?.domain
                                ? [routing.knowledgeTasks[0].domain]
                                : [],
                            signal,
                        });
                    const previousPointIds = new Set(
                        answerEvidence.map((hit) => hit.pointId),
                    );
                    const combinedEvidence = selectSellerCopilotEvidence([
                        answerEvidence,
                        fallbackEvidence,
                    ]);
                    const addedEvidenceCount = combinedEvidence.filter(
                        (hit) => !previousPointIds.has(hit.pointId),
                    ).length;
                    this.logger.log(
                        JSON.stringify({
                            event: 'seller_knowledge_grounding_retry',
                            requestId,
                            domain: routing.knowledgeTasks[0]?.domain,
                            resultCount: fallbackEvidence.length,
                            addedEvidenceCount,
                        }),
                    );

                    // Không gọi answer lần hai nếu retrieval chỉ trả lại evidence đã có.
                    if (!addedEvidenceCount) break;
                    answerEvidence = combinedEvidence;
                }

                answerStatus =
                    answerSupported || interactionMode === 'chat'
                        ? undefined
                        : 'unsupported';
                // Visual chỉ được chọn nếu domain của nó đã được planner route và nguồn backend tương ứng đã tải.
                const allowedVisualizations =
                    readsShopData && shopDataPresentation
                        ? shopDataPresentation.visualizationTypes.filter(
                              (type) =>
                                  answerTasks.some(
                                      (task) =>
                                          task.domain ===
                                          VISUALIZATION_DOMAIN[type],
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

                // Retrieval hit không đồng nghĩa đã trả lời được; unsupported không nhận citation để tránh nguồn gây hiểu nhầm.
                if (!answerSupported && interactionMode !== 'chat') {
                    logSellerCopilotAbstention(
                        this.logger,
                        requestId,
                        'insufficient_evidence',
                        answerEvidence.length,
                    );
                }
                if (answerSupported && answerEvidence.length) {
                    citations = mapSellerCopilotCitations(answerEvidence);
                    yield { type: 'sources', items: citations };
                }

                // Chỉ lưu provenance model đã chọn nếu payload tương ứng thật sự có trong request hiện tại.
                if (answerSupported) {
                    for (const sourceType of requestedDataSources) {
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
                    yield { type: 'data_sources', items: dataSources };
                }
                if (insights.length) {
                    yield { type: 'insight', items: insights };
                }
            } catch (error) {
                // Abort là control flow: lưu phần đã phát để history không mất nội dung, sau đó ném AbortSignal nguyên trạng.
                if (signal?.aborted) {
                    if (streamedAnswer.trim()) {
                        await this.repository.saveMessage({
                            conversationId: preparedChat.conversationId,
                            role: 'assistant',
                            content: streamedAnswer,
                            metadata: {
                                ...(citations.length ? { citations } : {}),
                                incomplete: true,
                                interactionMode,
                                modeSessionId: preparedChat.modeSessionId,
                            },
                        });
                    }
                    signal.throwIfAborted();
                }

                // Provider hỏng giữa stream thì thay câu đang hiện và xóa metadata chưa được xác nhận.
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
                assistantReply =
                    'Mình chưa thể xác minh câu trả lời từ tài liệu lúc này. Bạn thử gửi lại câu hỏi sau nhé.';
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

        return {
            assistantReply,
            citations,
            dataSources,
            insights,
            answerStatus,
            answerStatusReason,
            assistantResponseStreamed,
        };
    }
}
