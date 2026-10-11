// Nạp các nguồn backend mà plan cho phép rồi tạo context có giới hạn cho answer model.
// Service này không phát câu trả lời và không tự suy luận domain; routing/tenant đã được use case xác minh.
import { Injectable, Logger } from '@nestjs/common';
import type {
    SellerCopilotEvent,
    SellerCopilotInteractionMode,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import type { PreparedSellerCopilotChat } from '@/modules/seller-copilot/application/conversation/streaming/types/prepared-seller-copilot-chat.types';
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';
import type { SellerKnowledgeSearchHit } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import { AuthUserClient } from '@/modules/shop-profile/application/clients/auth-user.client';
import { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import { resolveSellerCopilotRange } from '@/modules/seller-copilot/application/conversation/utils/resolve-seller-copilot-range.util';
import type { SellerCopilotTaskRouting } from '@/modules/seller-copilot/application/answer/shared/utils/route-seller-copilot-tasks.util';
import { selectSellerCopilotEvidence } from '@/modules/seller-copilot/application/answer/shared/utils/seller-copilot-evidence.util';
import { buildShopDataAnswerContext } from '@/modules/seller-copilot/application/answer/modes/shop-data/context/build-shop-data-context.util';
import type { SellerCopilotShopDataPresentation } from '@/modules/seller-copilot/application/answer/modes/shop-data/types/seller-copilot-shop-data-presentation.types';
import type { LoadedSellerCopilotContext } from '@/modules/seller-copilot/application/conversation/streaming/types/loaded-seller-copilot-context.types';

// Đầu vào chứa scope đã xác thực, task đã route và presentation đã chuẩn hóa từ backend.
interface LoadSellerCopilotContextInput {
    preparedChat: PreparedSellerCopilotChat;
    request: SellerCopilotRequest;
    interactionMode: SellerCopilotInteractionMode;
    answerTasks: SellerQuestionTask[];
    routing: SellerCopilotTaskRouting;
    shopDataPresentation?: SellerCopilotShopDataPresentation | null;
    requestId: string;
    signal?: AbortSignal;
}

// Kết hợp dashboard/profile/catalog và knowledge retrieval mà vẫn phát status SSE đúng lúc chờ I/O.
@Injectable()
export class LoadSellerCopilotContextService {
    private readonly logger = new Logger(LoadSellerCopilotContextService.name);

    constructor(
        private readonly knowledgeRetrieval: SellerKnowledgeRetrievalService,
        private readonly dashboard: SellerDashboardService,
        private readonly authUser: AuthUserClient,
        private readonly inventoryAgent: SellerInventoryAgentService,
    ) {}

    // Tải song song các nguồn Shop Data, retrieval tài liệu theo task, rồi trả payload backend đã giới hạn cho answer.
    // Range không hợp lệ được giữ thành cờ clarification để caller dừng trước khi gọi model bằng kỳ mặc định.
    // Lỗi từng nguồn live được ghi unavailableSources; nguồn khác của câu hỏi nhiều ý vẫn có thể tiếp tục như cũ.
    async *load(
        input: LoadSellerCopilotContextInput,
    ): AsyncGenerator<SellerCopilotEvent, LoadedSellerCopilotContext> {
        const {
            preparedChat,
            request,
            interactionMode,
            answerTasks,
            routing,
            shopDataPresentation,
            requestId,
            signal,
        } = input;
        const {
            hasOrderQuestion,
            hasProductQuestion,
            hasProfileQuestion,
            knowledgeTasks,
            liveTasks,
            profileTasks,
            originalQuestion,
            canRetryWithOriginalQuestion,
        } = routing;
        const readsShopData =
            interactionMode === 'shop_data' || interactionMode === 'agent';
        const evidenceGroups: SellerKnowledgeSearchHit[][] = [];
        const contextData: Record<string, unknown> = {};
        const dashboardRange = resolveSellerCopilotRange(
            [
                request.message,
                ...answerTasks.map((task) => task.resolvedQuestion),
            ].join(' '),
            request.range,
        );

        // Tháng/năm không được hỗ trợ phải hỏi lại; dùng range mặc định ở đây sẽ tạo số đúng cho sai kỳ.
        if (readsShopData && liveTasks.length > 0 && dashboardRange === null) {
            contextData.rangeClarification = true;
        }

        // Catalog chỉ cần cho danh sách/chi tiết/tồn kho; count và sản phẩm bán chạy lấy từ aggregate khác.
        const needsProductCatalog =
            shopDataPresentation?.productPresentations.some(
                (presentation) =>
                    presentation === 'catalog' ||
                    presentation === 'detail' ||
                    presentation === 'low-stock' ||
                    presentation === 'no-revenue-list',
            ) ?? false;
        let shopSnapshot: LoadedSellerCopilotContext['shopSnapshot'];
        let productCatalog: LoadedSellerCopilotContext['productCatalog'];
        let accountProfile: LoadedSellerCopilotContext['accountProfile'];

        // Chỉ gọi service mà task yêu cầu; allSettled giữ lại dữ liệu nguồn thành công nếu nguồn phụ bị lỗi.
        if (
            readsShopData &&
            (liveTasks.length > 0 || hasProfileQuestion) &&
            (!liveTasks.length || dashboardRange !== null)
        ) {
            yield {
                type: 'status',
                phase: 'live_data',
                message: 'Đang tải hồ sơ và dữ liệu shop…',
            };
            const [dashboardResult, profileResult, productCatalogResult] =
                await Promise.allSettled([
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

            // Chỉ snapshot hoàn tất mới được dùng; lỗi dashboard không bị biến thành các chỉ số bằng 0.
            if (dashboardResult.status === 'fulfilled') {
                shopSnapshot = dashboardResult.value;
            } else {
                // Gắn lỗi dashboard vào đúng domain được hỏi để không ám chỉ sai nguồn nào đã mất.
                const unavailableDashboardSources = [
                    ...(liveTasks.some(
                        (task) => task.domain === 'seller-revenue',
                    )
                        ? ['Dữ liệu doanh thu']
                        : []),
                    ...(liveTasks.some(
                        (task) => task.domain === 'seller-orders',
                    )
                        ? ['Dữ liệu đơn hàng']
                        : []),
                    ...(liveTasks.some(
                        (task) => task.domain === 'seller-products-inventory',
                    )
                        ? ['Số liệu tổng hợp sản phẩm và tồn kho']
                        : []),
                ];
                contextData.unavailableSources =
                    unavailableDashboardSources.length
                        ? unavailableDashboardSources
                        : ['Dữ liệu tổng hợp shop'];
                this.logUnavailableSource(
                    requestId,
                    'seller-dashboard',
                    dashboardResult.reason,
                );
            }

            // Catalog được giới hạn theo productId đã gắn từ insight backend nếu đây là câu hỏi follow-up.
            if (
                productCatalogResult.status === 'fulfilled' &&
                productCatalogResult.value
            ) {
                productCatalog = productCatalogResult.value;
                const referencedProductId = answerTasks.find(
                    (task) => task.productId,
                )?.productId;
                if (referencedProductId) {
                    const referencedProducts = productCatalog.items.filter(
                        (product) => product.productId === referencedProductId,
                    );
                    productCatalog = {
                        ...productCatalog,
                        items: referencedProducts,
                        totalCount: referencedProducts.length,
                        hasMore: false,
                    };
                }
                contextData.productCatalog = productCatalog;

                // Chỉ bổ sung thumbnail còn thiếu; dữ liệu tên/doanh thu vẫn giữ từ Order Service.
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
                // Không dựng danh sách giả nếu Product Service lỗi; ghi rõ nguồn thiếu để answer không khẳng định catalog đầy đủ.
                contextData.unavailableSources = [
                    ...((contextData.unavailableSources as
                        string[] | undefined) ?? []),
                    'Danh sách sản phẩm và phân loại',
                ];
                this.logUnavailableSource(
                    requestId,
                    'product-catalog',
                    productCatalogResult.status === 'rejected'
                        ? productCatalogResult.reason
                        : undefined,
                );
            }

            // Profile không được gọi thừa; trường hợp cần profile nhưng service lỗi được đánh dấu riêng.
            if (profileResult.status === 'fulfilled') {
                accountProfile = profileResult.value;
            } else {
                contextData.unavailableSources = [
                    ...((contextData.unavailableSources as
                        string[] | undefined) ?? []),
                    'Hồ sơ tài khoản/shop',
                ];
                this.logUnavailableSource(
                    requestId,
                    'seller-profile',
                    profileResult.reason,
                );
            }
        }

        // Mỗi task knowledge có query/domain riêng để không trộn evidence giữa các ý trong câu hỏi nhiều phần.
        let originalQuestionWasRetried = false;
        if (knowledgeTasks.length) {
            yield {
                type: 'status',
                phase: 'retrieval',
                message: 'Đang tìm trong tài liệu đã xuất bản…',
            };
            const retrieved = await Promise.all(
                knowledgeTasks.map(async (task) => {
                    const primaryEvidence =
                        await this.knowledgeRetrieval.retrieve({
                            query: task.resolvedQuestion,
                            domainCodes: task.domain ? [task.domain] : [],
                            signal,
                        });

                    // Chỉ truy vấn lại câu gốc cho một topic mới; câu follow-up kiểu “còn cái đó?” không đủ ngữ nghĩa độc lập.
                    if (
                        primaryEvidence.length ||
                        !canRetryWithOriginalQuestion ||
                        !originalQuestion ||
                        task.resolvedQuestion.trim() === originalQuestion
                    ) {
                        return primaryEvidence;
                    }

                    const fallbackEvidence =
                        await this.knowledgeRetrieval.retrieve({
                            query: originalQuestion,
                            domainCodes: task.domain ? [task.domain] : [],
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

        // Hai mode dữ liệu dùng snapshot đã nạp theo tenant; mode khác chỉ query dashboard khi route live hợp lệ.
        if (liveTasks.length && (readsShopData ? shopSnapshot : true)) {
            yield {
                type: 'status',
                phase: 'live_data',
                message: 'Đang tải số liệu mới nhất của shop…',
            };
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
                          products: shopDataPresentation.productPresentations,
                      }
                    : undefined,
                productCatalog,
            );
            shopSnapshot = snapshot;
        }

        // Profile-only task ngoài hai mode dữ liệu được nạp tại đây; scope vẫn lấy từ user/shop đã xác thực.
        if (profileTasks.length && (readsShopData ? accountProfile : true)) {
            yield {
                type: 'status',
                phase: 'profile',
                message: 'Đang tải hồ sơ tài khoản và shop…',
            };
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

        // Hủy sau khi retrieval/live calls hoàn tất thì dừng trước khi hợp nhất payload hoặc gọi answer model.
        signal?.throwIfAborted();
        const evidence = selectSellerCopilotEvidence(evidenceGroups);
        const hasContextData = Boolean(
            contextData.liveData ||
            contextData.profile ||
            contextData.productCatalog,
        );
        const hasContextPayload = Object.keys(contextData).length > 0;
        const hasUnansweredKnowledge =
            knowledgeTasks.length > 0 && evidence.length === 0;

        return {
            contextData,
            dashboardRange,
            shopSnapshot,
            productCatalog,
            accountProfile,
            evidence,
            originalQuestionWasRetried,
            hasContextData,
            hasContextPayload,
            hasUnansweredKnowledge,
            routing,
        };
    }

    // Ghi mã nguồn và loại lỗi cùng requestId để truy vết, không đưa message có thể chứa URL/token vào log.
    private logUnavailableSource(
        requestId: string,
        source: string,
        error: unknown,
    ): void {
        this.logger.warn(
            JSON.stringify({
                event: 'seller_copilot_source_unavailable',
                requestId,
                source,
                errorType:
                    error instanceof Error ? error.name : 'unknown_error',
            }),
        );
    }
}
