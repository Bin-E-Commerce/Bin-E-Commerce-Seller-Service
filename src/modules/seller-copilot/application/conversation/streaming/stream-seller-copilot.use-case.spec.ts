// Kiểm thử điều phối hội thoại bằng dependency giả; không gọi AI provider hoặc database thật.
import { NotFoundException } from '@nestjs/common';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type {
    SellerCopilotEvent,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/conversation/types/seller-copilot.types';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import type { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import type { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import type { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/shared/planner/seller-question-understanding.service';
import type { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';
import type { SellerCopilotAnswerPort } from '@/modules/seller-copilot/application/answer/shared/ports/seller-copilot-answer.port';
import type { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import type { AuthUserClient } from '@/modules/shop-profile/application/clients/auth-user.client';
import type { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import type { SellerQuestionCapabilityRegistryProvider } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';

describe('StreamSellerCopilotUseCase', () => {
    let target: StreamSellerCopilotUseCase;
    let mockAccess: { resolveActiveShop: jest.Mock };
    let mockUnderstanding: { understand: jest.Mock };
    let mockKnowledgeRetrieval: { retrieve: jest.Mock };
    let mockAnswer: { stream: jest.Mock };
    let mockDashboard: { getOverview: jest.Mock };
    let mockAuthUser: { getCopilotProfile: jest.Mock };
    let mockInventoryAgent: {
        prepare: jest.Mock;
        searchProducts: jest.Mock;
        getProductCatalog: jest.Mock;
    };
    let mockRegistry: { getActiveRegistry: jest.Mock };
    let mockRepository: {
        findConversation: jest.Mock;
        createConversation: jest.Mock;
        saveMessage: jest.Mock;
        findMessagesByConversation: jest.Mock;
    };
    let mockModeSessions: { resolveForChat: jest.Mock };

    // Các ca retrieval chưa nêu mode giữ nguyên ý nghĩa test knowledge; ca mode mới chỉ định mode tường minh.
    async function prepareChat(request: SellerCopilotRequest) {
        request.interactionMode ??= 'knowledge';
        return target.prepare('owner-1', request);
    }

    // Mỗi test dùng planner và repository giả để kiểm tra tích hợp điều phối mà không gọi provider hay database thật.
    beforeEach(() => {
        mockAccess = {
            resolveActiveShop: jest.fn().mockResolvedValue({
                id: 'shop-1',
                ownerUserId: 'owner-1',
            }),
        };
        mockUnderstanding = {
            understand: jest.fn().mockResolvedValue({
                status: 'READY',
                contextRelation: 'NEW_TOPIC',
                tasks: [
                    {
                        requestType: 'SMALL_TALK',
                        domain: null,
                        resolvedQuestion: 'Chào bạn',
                    },
                ],
                clarificationQuestion: null,
                failureReason: null,
            }),
        };
        mockRepository = {
            findConversation: jest.fn(),
            createConversation: jest.fn().mockResolvedValue({
                id: 'conversation-1',
                ownerUserId: 'owner-1',
                shopId: 'shop-1',
            }),
            saveMessage: jest.fn().mockResolvedValue(undefined),
            findMessagesByConversation: jest.fn().mockResolvedValue([]),
        };
        mockModeSessions = {
            resolveForChat: jest.fn().mockResolvedValue({
                modeSessionId: 'mode-session-1',
            }),
        };
        mockKnowledgeRetrieval = {
            retrieve: jest.fn().mockResolvedValue([]),
        };
        mockAnswer = {
            stream: jest.fn().mockImplementation(async function* () {
                yield {
                    type: 'complete',
                    answer: 'Mình chưa đủ căn cứ [1].',
                    supported: true,
                };
            }),
        };
        mockDashboard = { getOverview: jest.fn() };
        mockAuthUser = { getCopilotProfile: jest.fn() };
        mockInventoryAgent = {
            prepare: jest.fn(),
            searchProducts: jest.fn().mockResolvedValue([
                {
                    productId: 'product-1',
                    productName: 'Áo xanh',
                    variantId: 'variant-1',
                    variantName: 'M',
                    sku: 'SKU-1',
                    sellerSku: null,
                    available: 7,
                    reserved: 2,
                },
            ]),
            getProductCatalog: jest.fn().mockResolvedValue({
                items: [],
                totalCount: 0,
                hasMore: false,
            }),
        };
        mockRegistry = {
            getActiveRegistry: jest.fn().mockResolvedValue({
                version: 1,
                domains: [
                    { code: 'shipping', kind: 'knowledge' },
                    { code: 'returns-refunds', kind: 'knowledge' },
                    { code: 'seller-revenue', kind: 'live-data' },
                    { code: 'seller-orders', kind: 'live-data' },
                    { code: 'seller-profile', kind: 'profile' },
                    { code: 'seller-products-inventory', kind: 'live-data' },
                ],
                requestTypes: [],
            }),
        };
        target = new StreamSellerCopilotUseCase(
            mockAccess as unknown as SellerCopilotAccessService,
            mockUnderstanding as unknown as SellerQuestionUnderstandingService,
            mockKnowledgeRetrieval as unknown as SellerKnowledgeRetrievalService,
            mockDashboard as unknown as SellerDashboardService,
            mockAuthUser as unknown as AuthUserClient,
            mockInventoryAgent as unknown as SellerInventoryAgentService,
            mockRegistry as unknown as SellerQuestionCapabilityRegistryProvider,
            mockAnswer as unknown as SellerCopilotAnswerPort,
            mockRepository as unknown as SellerCopilotRepositoryPort,
            mockModeSessions as unknown as ConversationModeSessionService,
        );
    });

    // Chat dùng planner để giữ ranh giới mode nhưng câu phổ thông không mở registry hoặc nguồn shop.
    it('should answer general conversation without opening shop sources', async () => {
        // Arrange
        const request = {
            message: '  Chào bạn  ',
            interactionMode: 'chat' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockRepository.createConversation).toHaveBeenCalledWith({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            title: 'Chào bạn',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(1, {
            conversationId: 'conversation-1',
            role: 'user',
            content: 'Chào bạn',
            metadata: {
                interactionMode: 'chat',
                modeSessionId: 'mode-session-1',
            },
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                conversationId: 'conversation-1',
                role: 'assistant',
                content: 'Mình chưa đủ căn cứ [1].',
                metadata: {
                    interactionMode: 'chat',
                    modeSessionId: 'mode-session-1',
                },
            }),
        );
        expect(mockRepository.findMessagesByConversation).toHaveBeenCalledWith(
            'conversation-1',
            16,
        );
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                question: request.message.trim(),
                interactionMode: 'chat',
            }),
        );
        expect(mockRegistry.getActiveRegistry).not.toHaveBeenCalled();
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockAuthUser.getCopilotProfile).not.toHaveBeenCalled();
        expect(events[0]?.type).toBe('started');
        expect(events.some((event) => event.type === 'status')).toBe(true);
        expect(events.some((event) => event.type === 'token')).toBe(true);
        expect(events.at(-1)?.type).toBe('done');
        expect(events[0]).toMatchObject({
            type: 'started',
            conversationId: 'conversation-1',
            modeSessionId: 'mode-session-1',
        });
        expect(events.find((event) => event.type === 'token')).toMatchObject({
            type: 'token',
            text: 'Mình chưa đủ căn cứ [1].',
        });
        expect(mockAccess.resolveActiveShop).toHaveBeenCalledWith('owner-1');
        expect(mockAccess.resolveActiveShop).toHaveBeenCalledTimes(1);
    });

    // Chat không có tài liệu nhưng vẫn có thể trả lời kiến thức chung; supported=false không được biến thành trạng thái thiếu nguồn.
    it('should keep a general chat answer without marking it as unsupported', async () => {
        // Arrange
        const naturalReply =
            'Màu lông chim rất đa dạng, tùy loài có thể là xanh, vàng, đỏ hoặc nâu.';
        mockAnswer.stream.mockImplementation(async function* () {
            yield {
                type: 'complete',
                answer: naturalReply,
                supported: false,
                visualizations: [],
                sourcesUsed: [],
            };
        });
        const request = {
            message: 'Bạn biết con chim màu gì không?',
            interactionMode: 'chat' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        const assistantMessage = mockRepository.saveMessage.mock.calls[1]?.[0];
        expect(assistantMessage.content).toBe(naturalReply);
        expect(assistantMessage.metadata).not.toHaveProperty('answerStatus');
        expect(events.some((event) => event.type === 'answer_status')).toBe(
            false,
        );
        expect(events.find((event) => event.type === 'token')).toMatchObject({
            type: 'token',
            text: naturalReply,
        });
        expect(mockRegistry.getActiveRegistry).not.toHaveBeenCalled();
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
    });

    // Hỏi BinGPT có mode nào là thông tin tĩnh của sản phẩm; trả trực tiếp, không tìm trong tài liệu seller.
    it('should explain the available modes directly in Chat', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'CAPABILITY_QUERY',
                    domain: 'seller-copilot-capabilities',
                    resolvedQuestion: 'BinGPT có những chế độ nào?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const request = {
            message: 'Bạn có những mode chức năng nào?',
            interactionMode: 'chat' as const,
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Đọc trọn stream để kiểm tra phản hồi capability được lưu như một câu trả lời bình thường.
        }

        // Assert
        const assistantMessage = mockRepository.saveMessage.mock.calls[1]?.[0];
        expect(assistantMessage.content).toContain('Trò chuyện');
        expect(assistantMessage.content).toContain('Dữ liệu shop');
        expect(assistantMessage.content).toContain('Tài liệu');
        expect(assistantMessage.content).toContain('AI Agent');
        expect(mockRegistry.getActiveRegistry).not.toHaveBeenCalled();
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
    });

    // Chat nhận dạng yêu cầu về chính sách nhưng chỉ hướng dẫn chuyển mode; không truy xuất hay sinh câu trả lời nghiệp vụ.
    it('should direct document questions to Knowledge mode without retrieving documents in Chat', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Chính sách giao hàng của shop là gì?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const request = {
            message: 'Chính sách giao hàng của shop là gì?',
            interactionMode: 'chat' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        const assistantMessage = mockRepository.saveMessage.mock.calls[1]?.[0];
        expect(assistantMessage.content).toContain('chế độ Tài liệu');
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({ interactionMode: 'chat' }),
        );
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(events.find((event) => event.type === 'token')).toMatchObject({
            type: 'token',
            text: expect.stringContaining('chế độ Tài liệu'),
        });
    });

    // Câu hỏi số liệu gõ nhầm ở mode Tài liệu phải được hướng sang Dữ liệu shop, không biến thành “không có tài liệu”.
    it('should redirect live-data questions from Knowledge mode to Shop Data without reading either source', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-products-inventory',
                    resolvedQuestion:
                        'Sản phẩm nào bán chạy nhất tháng 9 năm 2026?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const request = {
            message: 'Sản phẩm nào bán chạy nhất tháng 9/2026?',
            interactionMode: 'knowledge' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        const assistantMessage = mockRepository.saveMessage.mock.calls[1]?.[0];
        expect(assistantMessage.content).toContain('cần chế độ Dữ liệu shop');
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(events.find((event) => event.type === 'token')).toMatchObject({
            type: 'token',
            text: expect.stringContaining('cần chế độ Dữ liệu shop'),
        });
    });

    // Dữ liệu shop và thao tác có đích mode riêng; Chat chỉ phân loại, không gọi dashboard hay Agent.
    it.each([
        {
            requestType: 'READ_QUERY' as const,
            domain: 'seller-revenue',
            expectedMode: 'Dữ liệu shop',
        },
        {
            requestType: 'CHANGE_REQUEST' as const,
            domain: 'seller-products-inventory',
            expectedMode: 'AI Agent',
        },
    ])(
        'should direct $requestType to $expectedMode without executing it in Chat',
        async ({ requestType, domain, expectedMode }) => {
            // Arrange
            mockUnderstanding.understand.mockResolvedValue({
                status: 'READY',
                contextRelation: 'NEW_TOPIC',
                tasks: [
                    {
                        requestType,
                        domain,
                        resolvedQuestion: 'Yêu cầu liên quan đến shop',
                    },
                ],
                clarificationQuestion: null,
                failureReason: null,
            });
            const request = {
                message: 'Yêu cầu liên quan đến shop',
                interactionMode: 'chat' as const,
            };
            const preparedChat = await prepareChat(request);

            // Act
            for await (const _event of target.execute(preparedChat, request)) {
                // Đọc hết SSE để xác minh nhánh handoff hoàn tất và được lưu.
            }

            // Assert
            const assistantMessage =
                mockRepository.saveMessage.mock.calls[1]?.[0];
            expect(assistantMessage.content).toContain(expectedMode);
            expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
            expect(mockDashboard.getOverview).not.toHaveBeenCalled();
            expect(mockInventoryAgent.prepare).not.toHaveBeenCalled();
            expect(mockAnswer.stream).not.toHaveBeenCalled();
        },
    );

    // Mọi prompt chỉ nhận cặp hỏi-đáp của phiên hiện tại; divider và mode cũ là ranh giới tuyệt đối.
    it('should exclude messages from earlier modes before sending history to the planner', async () => {
        // Arrange
        mockModeSessions.resolveForChat.mockResolvedValue({
            modeSessionId: 'session-knowledge',
            interactionMode: 'knowledge',
        });
        mockRepository.findMessagesByConversation.mockResolvedValue([
            {
                id: 'old-user',
                conversationId: 'conversation-1',
                role: 'user',
                content: 'Câu hỏi ở mode trò chuyện',
                metadata: {
                    interactionMode: 'chat',
                    modeSessionId: 'session-chat',
                },
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: 'old-assistant',
                conversationId: 'conversation-1',
                role: 'assistant',
                content: 'Trả lời ở mode trò chuyện',
                metadata: {
                    interactionMode: 'chat',
                    modeSessionId: 'session-chat',
                },
                createdAt: new Date('2026-01-01T00:00:01.000Z'),
            },
            {
                id: 'mode-divider',
                conversationId: 'conversation-1',
                role: 'system',
                content: 'Bạn đã chuyển sang chế độ Tài liệu',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'session-knowledge',
                    timelineEvent: 'mode_changed',
                },
                createdAt: new Date('2026-01-01T00:00:02.000Z'),
            },
            {
                id: 'current-user',
                conversationId: 'conversation-1',
                role: 'user',
                content: 'Chính sách giao hàng là gì?',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'session-knowledge',
                },
                createdAt: new Date('2026-01-01T00:00:03.000Z'),
            },
            {
                id: 'current-assistant',
                conversationId: 'conversation-1',
                role: 'assistant',
                content: 'Mình có thể tra chính sách giao hàng.',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'session-knowledge',
                },
                createdAt: new Date('2026-01-01T00:00:04.000Z'),
            },
        ]);
        const request = {
            message: 'Cho mình biết thêm nhé',
            interactionMode: 'knowledge' as const,
            modeSessionId: 'session-knowledge',
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ trọn stream để planner nhận history như trong request thật.
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                question: request.message,
                history: [
                    {
                        role: 'user',
                        content: 'Chính sách giao hàng là gì?',
                    },
                    {
                        role: 'assistant',
                        content: 'Mình có thể tra chính sách giao hàng.',
                    },
                ],
            }),
        );
        expect(
            mockUnderstanding.understand.mock.calls[0]?.[0].history,
        ).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    content: 'Câu hỏi ở mode trò chuyện',
                }),
            ]),
        );
    });

    // Một lượt ngoài phạm vi/từ chối không được kéo chủ đề cũ sang câu hỏi chính sách mới.
    it('should exclude an unsupported exchange from the next planner context', async () => {
        // Arrange
        mockRepository.findMessagesByConversation.mockResolvedValue([
            {
                id: 'out-of-scope-question',
                conversationId: 'conversation-1',
                role: 'user',
                content: 'Chính sách khóa shop khi vi phạm là gì?',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: 'unsupported-reply',
                conversationId: 'conversation-1',
                role: 'assistant',
                content: 'Hiện tại mình chưa tìm thấy tài liệu phù hợp.',
                metadata: {
                    answerStatus: 'unsupported',
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
                createdAt: new Date('2026-01-01T00:00:01.000Z'),
            },
        ]);
        const request = {
            message: 'Chính sách giao hàng của shop gồm những nội dung nào?',
            interactionMode: 'knowledge' as const,
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ stream để xác minh history planner nhận được.
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                question: request.message,
                history: [],
            }),
        );
    });

    // Event started phải tới client trước khi planner hoàn tất để client biết conversationId.
    it('should emit started before waiting for the question planner', async () => {
        // Arrange
        const plannerResult = {
            status: 'READY' as const,
            contextRelation: 'NEW_TOPIC' as const,
            tasks: [
                {
                    requestType: 'SMALL_TALK' as const,
                    domain: null,
                    resolvedQuestion: 'Chào bạn',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        };
        let resolvePlanner!: (result: typeof plannerResult) => void;
        let signalPlannerStarted!: () => void;
        const plannerStarted = new Promise<void>((resolve) => {
            signalPlannerStarted = resolve;
        });
        mockUnderstanding.understand.mockImplementation(() => {
            signalPlannerStarted();
            return new Promise<typeof plannerResult>((resolve) => {
                resolvePlanner = resolve;
            });
        });
        const request = { message: 'Chào bạn' };
        const preparedChat = await prepareChat(request);
        const stream = target.execute(preparedChat, request, 'request-1');

        // Act
        const firstEvent = await stream.next();

        // Assert
        expect(firstEvent).toEqual({
            value: {
                type: 'started',
                conversationId: 'conversation-1',
                requestId: 'request-1',
                modeSessionId: 'mode-session-1',
            },
            done: false,
        });
        expect(mockUnderstanding.understand).not.toHaveBeenCalled();
        expect(mockRepository.saveMessage).toHaveBeenCalledWith({
            conversationId: 'conversation-1',
            role: 'user',
            content: 'Chào bạn',
            metadata: {
                interactionMode: 'knowledge',
                modeSessionId: 'mode-session-1',
            },
        });

        // Gọi bước kế tiếp để planner bắt đầu rồi giữ nó chờ, mô phỏng provider chưa phản hồi.
        const understandingStatus = await stream.next();
        expect(understandingStatus.value).toMatchObject({
            type: 'status',
            phase: 'understanding',
        });
        const tokenEventPromise = (async () => {
            let event = await stream.next();
            while (!event.done && event.value?.type !== 'token') {
                event = await stream.next();
            }
            return event;
        })();
        await plannerStarted;
        expect(mockUnderstanding.understand).toHaveBeenCalledTimes(1);

        // Mở khóa planner để generator hoàn tất và tránh để test treo ở promise giả.
        resolvePlanner(plannerResult);
        const tokenEvent = await tokenEventPromise;
        const doneEvent = await stream.next();
        expect([tokenEvent.value?.type, doneEvent.value?.type]).toEqual([
            'token',
            'done',
        ]);
    });

    // READ_QUERY phải retrieval theo domain, phát citation SSE và lưu citation cùng message để history hiển thị lại.
    it('should retrieve published knowledge and persist citations for a read query', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Phí vận chuyển được tính như thế nào?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const hit = {
            pointId: 'point-1',
            documentId: 'document-1',
            revisionId: 'revision-1',
            title: 'Chính sách vận chuyển',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí giao hàng',
            sectionPath: ['Phí giao hàng'],
            content: 'Phí phụ thuộc khu vực và đơn vị vận chuyển.',
            score: 0.84,
            version: '2',
        };
        mockKnowledgeRetrieval.retrieve.mockResolvedValue([hit]);
        mockAnswer.stream.mockImplementation(async function* () {
            yield { type: 'delta', text: 'Phí phụ thuộc khu vực ' };
            yield {
                type: 'delta',
                text: 'và đơn vị vận chuyển.',
            };
            yield {
                type: 'complete',
                answer: 'Phí phụ thuộc khu vực và đơn vị vận chuyển.',
                supported: true,
            };
        });
        const events: SellerCopilotEvent[] = [];
        const request = { message: 'Phí vận chuyển được tính như thế nào?' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledTimes(1);
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenCalledWith({
            query: 'Phí vận chuyển được tính như thế nào?',
            domainCodes: ['shipping'],
            signal: undefined,
        });
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'Phí vận chuyển được tính như thế nào?',
                evidence: [hit],
                signal: undefined,
            }),
        );
        expect(events.map((event) => event.type)).toEqual([
            'started',
            'status',
            'status',
            'status',
            'token',
            'token',
            'sources',
            'done',
        ]);
        expect(events[1]).toEqual({
            type: 'status',
            phase: 'understanding',
            message: 'Đang hiểu câu hỏi và ngữ cảnh hội thoại…',
        });
        expect(events[3]).toEqual({
            type: 'status',
            phase: 'answer',
            message: 'Đang tổng hợp câu trả lời…',
        });
        expect(events[6]).toEqual({
            type: 'sources',
            items: [
                {
                    id: 'point-1',
                    label: 'Chính sách vận chuyển · Phí giao hàng',
                    title: 'Chính sách vận chuyển',
                    sectionPath: ['Phí giao hàng'],
                    type: 'seller_knowledge',
                    excerpt: hit.content,
                    content: hit.content,
                    documentId: 'document-1',
                    domain: 'shipping',
                    version: '2',
                },
            ],
        });
        expect(events[4]).toEqual({
            type: 'token',
            text: 'Phí phụ thuộc khu vực ',
        });
        expect(events[5]).toEqual({
            type: 'token',
            text: 'và đơn vị vận chuyển.',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content: 'Phí phụ thuộc khu vực và đơn vị vận chuyển.',
                metadata: {
                    citations: [expect.objectContaining({ id: 'point-1' })],
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            }),
        );
    });

    // Nếu planner diễn giải lại câu hỏi tự đủ nghĩa nhưng query đó không có hit, thử nguyên văn một lần trong cùng domain.
    it('should retry an explicit new-topic question with the original wording when resolved retrieval is empty', async () => {
        // Arrange
        const hit = {
            pointId: 'shipping-point',
            documentId: 'shipping-document',
            revisionId: 'shipping-revision',
            title: 'Hướng dẫn giao hàng',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Quy trình giao hàng',
            sectionPath: ['Giao hàng', 'Quy trình'],
            content: 'Shop cần cấu hình địa chỉ lấy hàng và theo dõi vận đơn.',
            score: 0.82,
            version: '1',
        };
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion:
                        'Quy trình giao hàng của shop gồm những bước nào?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockKnowledgeRetrieval.retrieve
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([hit]);
        mockAnswer.stream.mockImplementation(async function* () {
            yield {
                type: 'complete',
                answer: 'Shop cần cấu hình địa chỉ lấy hàng và theo dõi vận đơn.',
                supported: true,
            };
        });
        const request = {
            message: '1. Chính sách giao hàng của shop gồm những nội dung nào?',
            interactionMode: 'knowledge' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenNthCalledWith(1, {
            query: 'Quy trình giao hàng của shop gồm những bước nào?',
            domainCodes: ['shipping'],
            signal: undefined,
        });
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenNthCalledWith(2, {
            query: request.message,
            domainCodes: ['shipping'],
            signal: undefined,
        });
        expect(events.some((event) => event.type === 'sources')).toBe(true);
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                metadata: expect.objectContaining({
                    citations: [
                        expect.objectContaining({ id: 'shipping-point' }),
                    ],
                }),
            }),
        );
    });

    // Không có kết quả ở cả truy vấn chuẩn hóa và câu gốc phải trả lời rõ nguyên nhân, không gọi answer model.
    it('should persist the no-retrieval reason when both safe queries return no evidence', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Quy định bảo hiểm hàng hóa là gì?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const request = {
            message: 'Chính sách bảo hiểm hàng hóa khi giao hàng là gì?',
            interactionMode: 'knowledge' as const,
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ stream để hoàn tất luồng fallback và persistence.
        }

        // Assert
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenCalledTimes(2);
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                metadata: expect.objectContaining({
                    answerStatus: 'unsupported',
                    answerStatusReason: 'no_retrieval_results',
                }),
            }),
        );
    });

    // Retrieval có thể trả hit cùng domain nhưng không trả lời được câu cụ thể; khi model từ chối, nguồn không được phát hay lưu.
    it('should hide retrieved sources when the answer is not supported by evidence', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Shop có chính sách thuế thế nào?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockKnowledgeRetrieval.retrieve.mockResolvedValue([
            {
                pointId: 'unrelated-point',
                documentId: 'shipping-document',
                revisionId: 'revision-1',
                title: 'Phí giao hàng',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
                section: 'Thanh toán',
                sectionPath: ['Thanh toán'],
                content: 'Phí vận chuyển được tính theo tuyến giao hàng.',
                score: 0.61,
                version: '1',
            },
        ]);
        mockAnswer.stream.mockImplementation(async function* () {
            yield {
                type: 'complete',
                answer: 'Mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này.',
                supported: false,
            };
        });
        const events: SellerCopilotEvent[] = [];
        const request = { message: 'Shop có chính sách thuế thế nào?' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(events.some((event) => event.type === 'sources')).toBe(false);
        expect(events).toContainEqual({
            type: 'answer_status',
            status: 'unsupported',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content:
                    'Mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này.',
                metadata: {
                    answerStatus: 'unsupported',
                    answerStatusReason: 'insufficient_evidence',
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            }),
        );
    });

    // Nếu hit đầu chưa đủ căn cứ, thử tìm lại bằng câu gốc; chỉ nguồn của lần trả lời được grounding mới được phát.
    it('should retry original wording once when initial evidence is insufficient', async () => {
        // Arrange
        const unrelatedHit = {
            pointId: 'weak-point',
            documentId: 'shipping-document',
            revisionId: 'shipping-revision',
            title: 'Hướng dẫn vận chuyển',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí giao hàng',
            sectionPath: ['Giao hàng', 'Phí'],
            content: 'Phí giao hàng phụ thuộc đơn vị vận chuyển.',
            score: 0.55,
            version: '1',
        };
        const relevantHit = {
            ...unrelatedHit,
            pointId: 'relevant-point',
            section: 'Quy trình giao hàng',
            sectionPath: ['Giao hàng', 'Quy trình'],
            content: 'Shop cấu hình địa chỉ lấy hàng và theo dõi vận đơn.',
            score: 0.88,
        };
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Shop cần làm gì để sẵn sàng giao hàng?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockKnowledgeRetrieval.retrieve
            .mockResolvedValueOnce([unrelatedHit])
            .mockResolvedValueOnce([relevantHit]);
        mockAnswer.stream
            .mockImplementationOnce(async function* () {
                yield {
                    type: 'complete',
                    answer: 'Mình chưa có đủ căn cứ.',
                    supported: false,
                };
            })
            .mockImplementationOnce(async function* () {
                yield {
                    type: 'complete',
                    answer: 'Shop cấu hình địa chỉ lấy hàng và theo dõi vận đơn.',
                    supported: true,
                };
            });
        const request = {
            message: '1. Chính sách giao hàng của shop gồm những nội dung nào?',
            interactionMode: 'knowledge' as const,
        };
        const preparedChat = await prepareChat(request);
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenCalledTimes(2);
        expect(mockKnowledgeRetrieval.retrieve).toHaveBeenNthCalledWith(2, {
            query: request.message,
            domainCodes: ['shipping'],
            signal: undefined,
        });
        expect(mockAnswer.stream).toHaveBeenCalledTimes(2);
        expect(mockAnswer.stream).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                evidence: [unrelatedHit, relevantHit],
            }),
        );
        expect(events.filter((event) => event.type === 'sources')).toHaveLength(
            1,
        );
        expect(
            events.find((event) => event.type === 'answer_status'),
        ).toBeUndefined();
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content: 'Shop cấu hình địa chỉ lấy hàng và theo dõi vận đơn.',
                metadata: expect.objectContaining({
                    citations: [
                        expect.objectContaining({ id: 'weak-point' }),
                        expect.objectContaining({ id: 'relevant-point' }),
                    ],
                }),
            }),
        );
    });

    // Nội dung câu hỏi được gửi nguyên nghĩa; không chọn layout bằng keyword ở application layer.
    it('should leave answer structure to the typed answer contract instead of keyword routing', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'FOLLOW_UP',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'product-content',
                    resolvedQuestion: 'Chính sách chung về sản phẩm là gì?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockRegistry.getActiveRegistry.mockResolvedValue({
            version: 1,
            domains: [{ code: 'product-content', kind: 'knowledge' }],
            requestTypes: [],
        });
        mockKnowledgeRetrieval.retrieve.mockResolvedValue([
            {
                pointId: 'product-policy-point',
                documentId: 'product-policy-document',
                revisionId: 'product-policy-revision',
                title: 'Hướng dẫn nội dung sản phẩm',
                domainCode: 'product-content',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
                section: 'Thông tin sản phẩm',
                sectionPath: ['Thông tin sản phẩm'],
                content:
                    'Mô tả cần rõ ràng và dựa trên thông tin kiểm chứng được.',
                score: 0.9,
                version: '1',
            },
        ]);
        const request = { message: 'Chính sách chung về sản phẩm' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ toàn bộ stream để assertion kiểm tra mode gửi tới answer provider.
        }

        // Assert
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'Chính sách chung về sản phẩm là gì?',
            }),
        );
        expect(mockAnswer.stream.mock.calls[0][0]).not.toHaveProperty(
            'responseMode',
        );
    });

    // Điểm rerank thuộc từng câu hỏi nên câu hỏi phụ phải giữ được hạng đầu dù điểm số tuyệt đối thấp hơn.
    it('should merge multi-query evidence by per-query rank instead of comparing raw rerank scores', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Phí giao hàng?',
                },
                {
                    requestType: 'READ_QUERY',
                    domain: 'returns-refunds',
                    resolvedQuestion: 'Điều kiện trả hàng?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const shippingHit = {
            pointId: 'shipping-point',
            documentId: 'shipping-document',
            revisionId: 'shipping-revision',
            title: 'Chính sách giao hàng',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí',
            sectionPath: ['Phí'],
            content: 'Phí giao hàng theo tuyến.',
            score: 0.18,
            version: '1',
        };
        const returnsHit = {
            ...shippingHit,
            pointId: 'returns-point',
            documentId: 'returns-document',
            revisionId: 'returns-revision',
            title: 'Chính sách trả hàng',
            domainCode: 'returns-refunds',
            content: 'Điều kiện trả hàng.',
            score: 0.97,
        };
        mockKnowledgeRetrieval.retrieve
            .mockResolvedValueOnce([shippingHit])
            .mockResolvedValueOnce([returnsHit]);
        const request = { message: 'Phí giao hàng và điều kiện trả hàng?' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ stream để assertion kiểm tra evidence đã tới answer provider.
        }

        // Assert
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({ evidence: [shippingHit, returnsHit] }),
        );
    });

    // History có phản hồi bảo trì cũ thì không gửi phản hồi đó làm ngữ cảnh, nhưng vẫn giữ câu hỏi seller trước đây.
    it('should pass recent useful conversation context to the question planner', async () => {
        // Arrange
        mockRepository.findConversation.mockResolvedValue({
            id: 'conversation-1',
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
        });
        mockRepository.findMessagesByConversation.mockResolvedValue([
            {
                role: 'user',
                content: 'Đơn hàng của tôi đang giao',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
            {
                role: 'assistant',
                content:
                    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
            {
                role: 'assistant',
                content: 'Shop có 4 đơn hàng đang xử lý',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
        ]);
        const request = {
            conversationId: 'conversation-1',
            message: 'Nếu nó vẫn đứng đó thì sao?',
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ stream để chạy toàn bộ điều phối.
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'Nếu nó vẫn đứng đó thì sao?',
                history: [
                    {
                        role: 'user',
                        content: 'Đơn hàng của tôi đang giao',
                    },
                    {
                        role: 'assistant',
                        content: 'Shop có 4 đơn hàng đang xử lý',
                    },
                ],
            }),
        );
    });

    // Câu trả lời “cả hai” chỉ có nghĩa khi giữ câu hỏi làm rõ của assistant trong history.
    it('should keep clarification context while excluding a temporary assistant reply', async () => {
        // Arrange
        mockRepository.findConversation.mockResolvedValue({
            id: 'conversation-1',
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
        });
        mockRepository.findMessagesByConversation.mockResolvedValue([
            {
                role: 'user',
                content: 'Mình muốn xem thông tin của mình',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
            {
                role: 'assistant',
                content:
                    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
            {
                role: 'assistant',
                content: 'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
                metadata: {
                    interactionMode: 'knowledge',
                    modeSessionId: 'mode-session-1',
                },
            },
        ]);
        const request = {
            conversationId: 'conversation-1',
            message: 'Cả hai',
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const _event of target.execute(preparedChat, request)) {
            // Tiêu thụ stream để kiểm tra context được tạo trước khi phát câu trả lời.
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'Cả hai',
                history: [
                    {
                        role: 'user',
                        content: 'Mình muốn xem thông tin của mình',
                    },
                    {
                        role: 'assistant',
                        content:
                            'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
                    },
                ],
            }),
        );
    });

    // Khi planner chưa đủ căn cứ, câu hỏi làm rõ đã được validate được trả thẳng và lưu làm ngữ cảnh lượt kế tiếp.
    it('should return the planner clarification instead of a maintenance message', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'NEEDS_CLARIFICATION',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion:
                'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
            failureReason: null,
        });
        const events: SellerCopilotEvent[] = [];
        const request = { message: 'Thông tin của tôi' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(events.find((event) => event.type === 'token')).toEqual({
            type: 'token',
            text: 'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content: 'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
            }),
        );
    });

    // Planner lỗi ở Chat không có task đáng tin cậy; hướng dẫn chọn mode theo nhu cầu thay vì chỉ báo AI chưa sẵn sàng.
    it('should guide the user to the matching mode when the Chat planner is unavailable', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'PLANNER_UNAVAILABLE',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: null,
            failureReason: 'AI_NOT_CONFIGURED',
        });
        const events: SellerCopilotEvent[] = [];
        const request = {
            message: 'Doanh thu tuần này thế nào?',
            interactionMode: 'chat' as const,
        };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(events.find((event) => event.type === 'token')).toEqual({
            type: 'token',
            text: 'Mình chưa phân loại được câu hỏi lúc này. Nếu bạn muốn xem doanh thu, sản phẩm, tồn kho, đơn hàng hoặc hồ sơ shop, hãy chuyển sang mode Dữ liệu shop rồi gửi lại nhé. Câu hỏi về chính sách/hướng dẫn thì chọn Tài liệu; yêu cầu thao tác trên shop thì chọn AI Agent 🙂.',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content:
                    'Mình chưa phân loại được câu hỏi lúc này. Nếu bạn muốn xem doanh thu, sản phẩm, tồn kho, đơn hàng hoặc hồ sơ shop, hãy chuyển sang mode Dữ liệu shop rồi gửi lại nhé. Câu hỏi về chính sách/hướng dẫn thì chọn Tài liệu; yêu cầu thao tác trên shop thì chọn AI Agent 🙂.',
            }),
        );
    });

    // Stop giữa lúc model đang trả lời phải lưu phần đã nhận nhưng đánh dấu để planner không xem là context hoàn chỉnh.
    it('persists a streamed partial answer as incomplete when the client aborts', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Phí vận chuyển?',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockKnowledgeRetrieval.retrieve.mockResolvedValue([
            {
                pointId: 'shipping-point',
                documentId: 'shipping-document',
                revisionId: 'shipping-revision',
                title: 'Chính sách vận chuyển',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
                section: 'Phí giao hàng',
                sectionPath: ['Phí giao hàng'],
                content: 'Phí được tính theo tuyến.',
                score: 0.84,
                version: '1',
            },
        ]);
        mockAnswer.stream.mockImplementation(async function* ({
            signal,
        }: {
            signal: AbortSignal;
        }) {
            yield { type: 'delta', text: 'Phí được tính ' };
            await new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                });
            });
        });
        const request = { message: 'Phí vận chuyển?' };
        const preparedChat = await prepareChat(request);
        const abortController = new AbortController();
        const stream = target.execute(
            preparedChat,
            request,
            'request-1',
            abortController.signal,
        );

        // Act
        await stream.next(); // started
        let deltaEvent = await stream.next();
        // Source chỉ phát sau khi answer xác nhận grounding; ca này abort giữa stream nên chờ tới token thay vì dựa vào thứ tự event cũ.
        while (deltaEvent.value?.type !== 'token') {
            deltaEvent = await stream.next();
        }
        const nextAnswerEvent = stream.next();
        abortController.abort();

        // Assert
        expect(deltaEvent.value).toEqual({
            type: 'token',
            text: 'Phí được tính ',
        });
        await expect(nextAnswerEvent).rejects.toBeDefined();
        expect(mockRepository.saveMessage).toHaveBeenLastCalledWith({
            conversationId: 'conversation-1',
            role: 'assistant',
            content: 'Phí được tính ',
            metadata: {
                incomplete: true,
                interactionMode: 'knowledge',
                modeSessionId: 'mode-session-1',
            },
        });
    });

    // Browser hủy trong lúc planner đang chờ phải dừng lượt xử lý và không lưu câu assistant giả.
    it('should stop the planner and skip assistant persistence when the stream is aborted', async () => {
        // Arrange
        const request = { message: 'Doanh thu tuần này thế nào?' };
        const preparedChat = await prepareChat(request);
        const abortController = new AbortController();
        mockUnderstanding.understand.mockImplementation(
            ({ signal }: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(signal.reason),
                        { once: true },
                    );
                }),
        );
        const stream = target.execute(
            preparedChat,
            request,
            'request-1',
            abortController.signal,
        );

        // Act
        await stream.next();
        await stream.next();
        const plannerEvent = stream.next();
        abortController.abort();

        // Assert
        await expect(plannerEvent).rejects.toBeDefined();
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({ signal: abortController.signal }),
        );
        expect(mockRepository.saveMessage).toHaveBeenCalledTimes(1);
    });

    // Không tồn tại conversation trong owner/shop scope phải dừng trước khi lưu bất kỳ message nào.
    it('rejects a conversation outside the authenticated tenant', async () => {
        // Arrange
        mockRepository.findConversation.mockResolvedValue(null);
        const request = {
            conversationId: 'foreign-conversation',
            message: 'Tin nhắn',
        };

        // Act & Assert
        await expect(target.prepare('owner-1', request)).rejects.toThrow(
            NotFoundException,
        );
        expect(mockRepository.saveMessage).not.toHaveBeenCalled();
        expect(
            mockRepository.findMessagesByConversation,
        ).not.toHaveBeenCalled();
        expect(mockUnderstanding.understand).not.toHaveBeenCalled();
    });

    // Doanh thu chỉ cần snapshot live; planner định tuyến domain để không nạp account profile ngoài câu hỏi.
    it('loads only the revenue domain selected by the planner in shop-data mode', async () => {
        const request = {
            message: 'Doanh thu tháng này thế nào?',
            interactionMode: 'shop_data' as const,
            range: '30d' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-revenue',
                    resolvedQuestion: request.message,
                    shopDataIntent: 'revenue_total',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockRegistry.getActiveRegistry.mockResolvedValue({
            version: 1,
            domains: [
                {
                    code: 'seller-profile',
                    kind: 'profile',
                    label: 'Hồ sơ',
                    description: 'Hồ sơ seller hiện tại',
                    documentBacked: false,
                },
                {
                    code: 'seller-revenue',
                    kind: 'live-data',
                    label: 'Doanh thu',
                    description: 'Dữ liệu doanh thu hiện tại',
                    documentBacked: false,
                },
            ],
            requestTypes: [],
        });
        mockDashboard.getOverview.mockResolvedValue({
            generatedAt: '2026-10-05T00:00:00.000Z',
            timezone: 'Asia/Ho_Chi_Minh',
            range: { from: '2026-10-01', to: '2026-10-02' },
            kpis: { pendingReturns: 0 },
            orderStatusCounts: [],
            latestOrders: [],
            recentReturnOrders: [],
            recentReturnOrdersHasMore: false,
            topProducts: [
                {
                    productId: 'product-1',
                    name: 'Áo thun thể thao',
                    thumbnailUrl: 'https://cdn.example.test/shirt.webp',
                    quantitySold: 3,
                    revenue: 555000,
                },
            ],
            revenueTrend: [
                { date: '2026-10-01', grossRevenue: 100000, orderCount: 1 },
                { date: '2026-10-02', grossRevenue: 200000, orderCount: 2 },
            ],
        });
        mockAuthUser.getCopilotProfile.mockResolvedValue({
            fullName: 'Người bán',
            email: 'seller@example.test',
            phone: '0900000000',
            role: 'seller',
            status: 'active',
        });
        mockAnswer.stream.mockImplementation(async function* () {
            yield { type: 'delta', text: 'Doanh thu là 10.' };
            yield {
                type: 'complete',
                answer: 'Doanh thu là 10.',
                supported: true,
                visualizations: ['revenue_trend', 'top_products'],
                sourcesUsed: ['live_data'],
            };
        });
        const events: SellerCopilotEvent[] = [];

        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        expect(mockDashboard.getOverview).toHaveBeenCalledWith(
            'owner-1',
            'current-month',
        );
        expect(mockAuthUser.getCopilotProfile).not.toHaveBeenCalled();
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({
                interactionMode: 'shop_data',
                question: request.message,
            }),
        );
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                contextData: expect.stringContaining('liveData'),
                history: [],
            }),
        );
        // Revenue-only input không được để model thấy catalog, kể cả khi dashboard snapshot có topProducts.
        const answerInput = mockAnswer.stream.mock.calls[0]?.[0];
        expect(answerInput?.contextData).not.toContain('topProducts');
        expect(events.find((event) => event.type === 'data_sources')).toEqual({
            type: 'data_sources',
            items: [{ kind: 'live_data', label: 'Dữ liệu live của shop' }],
        });
        expect(events.filter((event) => event.type === 'token')).toEqual([
            { type: 'token', text: 'Doanh thu là 10.' },
        ]);
        expect(events.find((event) => event.type === 'insight')).toEqual({
            type: 'insight',
            items: [
                {
                    type: 'REVENUE_TREND',
                    range: { from: '2026-10-01', to: '2026-10-02' },
                    points: [
                        { date: '2026-10-01', grossRevenue: 100000 },
                        { date: '2026-10-02', grossRevenue: 200000 },
                    ],
                },
            ],
        });
        expect(
            events
                .filter((event) => event.type === 'insight')
                .flatMap((event) => event.items)
                .some((insight) => insight.type === 'PRODUCT_PERFORMANCE'),
        ).toBe(false);
        expect(mockRepository.saveMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    insights: [
                        expect.objectContaining({ type: 'REVENUE_TREND' }),
                    ],
                }),
            }),
        );
    });

    // Hỏi hồ sơ chỉ nạp account và shop profile, không gọi dashboard nếu domain live không được hỏi.
    it('loads only the authenticated profile domain in shop-data mode', async () => {
        const request = {
            message: 'Thông tin shop của tôi là gì?',
            interactionMode: 'shop_data' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-profile',
                    resolvedQuestion: request.message,
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockRegistry.getActiveRegistry.mockResolvedValue({
            version: 1,
            domains: [
                {
                    code: 'seller-profile',
                    kind: 'profile',
                    label: 'Hồ sơ',
                    description: 'Hồ sơ seller hiện tại',
                    documentBacked: false,
                },
                {
                    code: 'seller-revenue',
                    kind: 'live-data',
                    label: 'Doanh thu',
                    description: 'Dữ liệu doanh thu hiện tại',
                    documentBacked: false,
                },
            ],
            requestTypes: [],
        });
        mockAuthUser.getCopilotProfile.mockResolvedValue({
            fullName: 'Người bán',
            email: 'seller@example.test',
            phone: '0900000000',
            role: 'seller',
            status: 'active',
        });
        mockDashboard.getOverview.mockResolvedValue({
            generatedAt: '2026-10-05T00:00:00.000Z',
            timezone: 'Asia/Ho_Chi_Minh',
            range: '30d',
            kpis: { pendingReturns: 0 },
            orderStatusCounts: [],
            latestOrders: [],
            recentReturnOrders: [],
            recentReturnOrdersHasMore: false,
            topProducts: [],
            revenueTrend: [],
        });

        for await (const _event of target.execute(preparedChat, request)) {
            // Đọc hết generator để khẳng định hồ sơ được chuyển đến answer rồi lưu như câu trả lời thường.
        }

        expect(mockAuthUser.getCopilotProfile).toHaveBeenCalledWith('owner-1');
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({ interactionMode: 'shop_data' }),
        );
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                contextData: expect.stringContaining('profile'),
            }),
        );
    });

    // Câu hỏi sản phẩm nhận catalog đầy đủ có ảnh/biến thể; không dùng search mười candidate làm danh sách giả.
    it('adds the full product catalog without searching Qdrant or variant candidates', async () => {
        const request = {
            message: 'Áo xanh còn bao nhiêu trong kho?',
            range: '30d' as const,
            interactionMode: 'shop_data' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-products-inventory',
                    resolvedQuestion: request.message,
                    shopDataIntent: 'product_detail',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockDashboard.getOverview.mockResolvedValue({
            generatedAt: '2026-10-05T00:00:00.000Z',
            timezone: 'Asia/Ho_Chi_Minh',
            range: '30d',
            kpis: { pendingReturns: 0 },
            orderStatusCounts: [],
            latestOrders: [],
            recentReturnOrders: [],
            recentReturnOrdersHasMore: false,
            topProducts: [],
            revenueTrend: [],
        });
        mockAuthUser.getCopilotProfile.mockResolvedValue({
            fullName: 'Người bán',
            email: 'seller@example.test',
            phone: '0900000000',
            role: 'seller',
            status: 'active',
        });
        mockInventoryAgent.getProductCatalog.mockResolvedValue({
            items: [
                {
                    productId: 'product-1',
                    name: 'Áo xanh',
                    description: 'Áo thể thao.',
                    thumbnailUrl: 'https://cdn.example.test/shirt.jpg',
                    status: 'ACTIVE',
                    totalSold: 4,
                    availableTotal: 7,
                    variantCount: 1,
                    hasMoreVariants: false,
                    variants: [
                        {
                            variantId: 'variant-1',
                            name: 'Size M',
                            sku: 'SKU-1',
                            sellerSku: 'SHOP-1',
                            options: [{ name: 'Size', value: 'M' }],
                            price: 185000,
                            originalPrice: null,
                            available: 7,
                            reserved: 2,
                            quantitySold: 4,
                            lowStockThreshold: 5,
                            thumbnailUrl: 'https://cdn.example.test/shirt.jpg',
                        },
                    ],
                },
            ],
            totalCount: 1,
            hasMore: false,
        });

        for await (const _event of target.execute(preparedChat, request)) {
            // Đọc hết stream để kiểm chứng cả lookup lẫn việc đưa kết quả vào câu trả lời.
        }

        expect(mockInventoryAgent.getProductCatalog).toHaveBeenCalledWith(
            'shop-1',
            'owner-1',
        );
        expect(mockInventoryAgent.searchProducts).not.toHaveBeenCalled();
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({ interactionMode: 'shop_data' }),
        );
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                contextData: expect.stringContaining('productCatalog'),
            }),
        );
    });

    // Câu hỏi đơn hoàn trả chỉ nhận domain seller-orders; dù model đề nghị profile, backend không phát sai card hồ sơ.
    it('renders return order details with product snapshots and excludes the unrelated profile card', async () => {
        // Arrange
        const request = {
            message: 'Cho tôi thông tin các đơn hàng hoàn trả',
            interactionMode: 'shop_data' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-orders',
                    resolvedQuestion: request.message,
                    shopDataIntent: 'return_orders',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const returnedOrder = {
            id: 'order-return-1',
            orderNumber: 'BIN-RETURN-001',
            status: 'CONFIRMED',
            fulfillmentStatus: 'RETURN_REFUND',
            grossAmount: 450000,
            itemCount: 1,
            itemLineCount: 1,
            items: [
                {
                    productId: 'product-1',
                    name: 'Áo thể thao',
                    thumbnailUrl: 'https://cdn.example.test/shirt.jpg',
                    quantity: 1,
                    lineTotal: 450000,
                },
            ],
            createdAt: '2026-09-19T03:00:00.000Z',
        };
        mockDashboard.getOverview.mockResolvedValue({
            generatedAt: '2026-10-05T00:00:00.000Z',
            timezone: 'Asia/Ho_Chi_Minh',
            range: {
                key: '30d',
                from: '2026-09-06T17:00:00.000Z',
                to: '2026-10-06T10:00:00.000Z',
                previousFrom: '2026-08-07T17:00:00.000Z',
                previousTo: '2026-09-06T17:00:00.000Z',
            },
            kpis: {
                grossRevenue: 0,
                grossRevenuePreviousPeriod: 0,
                grossRevenueChangePercent: 0,
                orderCount: 0,
                orderCountPreviousPeriod: 0,
                orderChangePercent: 0,
                pendingConfirmation: 0,
                pendingShipment: 0,
                shipping: 0,
                pendingReturns: 1,
                activeProducts: 0,
                outOfStockProducts: 0,
            },
            orderStatusCounts: {
                all: 1,
                pendingConfirmation: 0,
                pendingShipment: 0,
                shipping: 0,
                delivered: 0,
                completed: 0,
                cancelled: 0,
                returnRefund: 1,
            },
            latestOrders: [returnedOrder],
            recentReturnOrders: [returnedOrder],
            recentReturnOrdersHasMore: false,
            topProducts: [],
            revenueTrend: [],
        });
        mockAuthUser.getCopilotProfile.mockResolvedValue({
            fullName: 'Người bán',
            email: 'seller@example.test',
            phone: null,
            role: 'seller',
            status: 'active',
        });
        mockAnswer.stream.mockImplementation(async function* () {
            yield {
                type: 'complete',
                answer: 'Đây là thông tin đơn hoàn trả.',
                supported: true,
                visualizations: ['seller_profile', 'return_orders'],
                sourcesUsed: ['live_data', 'seller_profile'],
            };
        });
        const events: SellerCopilotEvent[] = [];

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockAuthUser.getCopilotProfile).not.toHaveBeenCalled();
        expect(mockAnswer.stream).toHaveBeenCalledWith(
            expect.objectContaining({
                interactionMode: 'shop_data',
                contextData: expect.not.stringContaining('profile'),
            }),
        );
        expect(events.find((event) => event.type === 'insight')).toEqual({
            type: 'insight',
            items: [
                {
                    type: 'RETURN_ORDERS',
                    orders: [
                        {
                            ...returnedOrder,
                            cancelReason: null,
                            returnReason: null,
                            returnDescription: null,
                        },
                    ],
                    hasMore: false,
                },
            ],
        });
    });

    // Hồ sơ là domain duy nhất được hỏi; Auth lỗi thì không gọi dashboard để lấp dữ liệu thay thế.
    it('does not substitute dashboard data when the requested profile source fails', async () => {
        const request = {
            message: 'Thông tin shop của tôi là gì?',
            interactionMode: 'shop_data' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-profile',
                    resolvedQuestion: request.message,
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        mockAuthUser.getCopilotProfile.mockRejectedValue(
            new Error('Auth service unavailable'),
        );
        const events: SellerCopilotEvent[] = [];

        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(mockAuthUser.getCopilotProfile).toHaveBeenCalledTimes(1);
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
        expect(
            events.some(
                (event) =>
                    event.type === 'token' &&
                    event.text.includes('chưa tải được hồ sơ'),
            ),
        ).toBe(true);
    });

    // Kỳ thời gian ngoài allowlist phải hỏi lại; tuyệt đối không âm thầm dùng 30 ngày mặc định.
    it('asks for a supported range instead of fetching the default range', async () => {
        const request = {
            message: 'Doanh thu năm ngoái thế nào?',
            interactionMode: 'shop_data' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-revenue',
                    resolvedQuestion: request.message,
                    shopDataIntent: 'revenue_total',
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const events: SellerCopilotEvent[] = [];

        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockAuthUser.getCopilotProfile).not.toHaveBeenCalled();
        expect(mockUnderstanding.understand).toHaveBeenCalledWith(
            expect.objectContaining({ interactionMode: 'shop_data' }),
        );
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(
            events.some(
                (event) =>
                    event.type === 'token' && event.text.includes('7, 30, 90'),
            ),
        ).toBe(true);
    });

    // Chế độ @BinGPT chỉ tạo preview sau khi planner phân loại đúng lệnh; bước này không được ghi tồn kho.
    it('prepares an agent inventory proposal without writing inventory', async () => {
        const request = {
            message: '@BinGPT đặt tồn Áo xanh size M thành 12',
            interactionMode: 'agent' as const,
        };
        const preparedChat = await prepareChat(request);
        mockUnderstanding.understand.mockResolvedValue({
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'CHANGE_REQUEST',
                    domain: 'seller-products-inventory',
                    resolvedQuestion: request.message,
                },
            ],
            clarificationQuestion: null,
            failureReason: null,
        });
        const expiresAt = new Date('2026-10-06T10:10:00.000Z');
        mockInventoryAgent.prepare.mockResolvedValue({
            kind: 'proposal',
            proposalId: 'proposal-1',
            payload: {
                productId: 'product-1',
                productName: 'Áo xanh',
                variantId: 'variant-1',
                variantName: 'M',
                expectedAvailable: 7,
                nextAvailable: 12,
            },
            expiresAt,
        });
        const events: SellerCopilotEvent[] = [];

        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        expect(mockInventoryAgent.prepare).toHaveBeenCalledWith({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: request.message,
        });
        expect(
            events.find((event) => event.type === 'action_proposed'),
        ).toMatchObject({
            proposalId: 'proposal-1',
            action: {
                kind: 'SET_INVENTORY',
                productId: 'product-1',
                currentAvailable: 7,
                nextAvailable: 12,
            },
        });
        expect(mockAnswer.stream).not.toHaveBeenCalled();
        expect(mockDashboard.getOverview).not.toHaveBeenCalled();
        expect(mockKnowledgeRetrieval.retrieve).not.toHaveBeenCalled();
    });
});
