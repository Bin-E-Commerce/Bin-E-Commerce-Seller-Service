// Kiểm thử điều phối hội thoại bằng dependency giả; không gọi AI provider hoặc database thật.
import { NotFoundException } from '@nestjs/common';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/shared/ports/seller-copilot-repository.port';
import type {
    SellerCopilotEvent,
    SellerCopilotRequest,
} from '@/modules/seller-copilot/application/shared/types/seller-copilot.types';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import type { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import type { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/planner/classification/seller-question-understanding.service';

describe('StreamSellerCopilotUseCase', () => {
    let target: StreamSellerCopilotUseCase;
    let mockAccess: { resolveActiveShop: jest.Mock };
    let mockUnderstanding: { understand: jest.Mock };
    let mockRepository: {
        findConversation: jest.Mock;
        createConversation: jest.Mock;
        saveMessage: jest.Mock;
        findMessagesByConversation: jest.Mock;
    };

    // Tạo context qua đúng bước preflight mà controller dùng, để test không thể bỏ qua tenant/conversation validation.
    async function prepareChat(request: SellerCopilotRequest) {
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
        target = new StreamSellerCopilotUseCase(
            mockAccess as unknown as SellerCopilotAccessService,
            mockUnderstanding as unknown as SellerQuestionUnderstandingService,
            mockRepository as unknown as SellerCopilotRepositoryPort,
        );
    });

    // Chat mới phải phân loại câu user, dùng kết quả SMALL_TALK để trả lời gọn và giữ nguyên SSE contract.
    it('should classify a new chat and reply naturally to small talk', async () => {
        // Arrange
        const request = { message: '  Chào bạn  ' };
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
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(2, {
            conversationId: 'conversation-1',
            role: 'assistant',
            content: 'Mình đây 🙂 Bạn cần mình hỗ trợ gì về shop?',
        });
        expect(mockRepository.findMessagesByConversation).toHaveBeenCalledWith(
            'conversation-1',
            16,
        );
        expect(mockUnderstanding.understand).toHaveBeenCalledWith({
            question: 'Chào bạn',
            history: [],
        });
        expect(events.map((event) => event.type)).toEqual([
            'started',
            'token',
            'done',
        ]);
        expect(events[0]).toMatchObject({
            type: 'started',
            conversationId: 'conversation-1',
        });
        expect(events[1]).toMatchObject({
            type: 'token',
            text: 'Mình đây 🙂 Bạn cần mình hỗ trợ gì về shop?',
        });
        expect(mockAccess.resolveActiveShop).toHaveBeenCalledWith('owner-1');
        expect(mockAccess.resolveActiveShop).toHaveBeenCalledTimes(1);
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
            },
            done: false,
        });
        expect(mockUnderstanding.understand).not.toHaveBeenCalled();
        expect(mockRepository.saveMessage).toHaveBeenCalledWith({
            conversationId: 'conversation-1',
            role: 'user',
            content: 'Chào bạn',
        });

        // Gọi bước kế tiếp để planner bắt đầu rồi giữ nó chờ, mô phỏng provider chưa phản hồi.
        const tokenEventPromise = stream.next();
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

    // Câu nghiệp vụ vẫn được phân loại, nhưng Phase 1 chưa truy vấn tài liệu hoặc dữ liệu live để tạo đáp án.
    it('should keep business answers unavailable until retrieval and answer phases are integrated', async () => {
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
        const events: SellerCopilotEvent[] = [];
        const request = { message: 'Phí vận chuyển tính sao?' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(mockUnderstanding.understand).toHaveBeenCalledTimes(1);
        expect(events[1]).toEqual({
            type: 'token',
            text: 'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
        });
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
            },
            {
                role: 'assistant',
                content:
                    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
            },
            {
                role: 'assistant',
                content: 'Shop có 4 đơn hàng đang xử lý',
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
        expect(mockUnderstanding.understand).toHaveBeenCalledWith({
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
        });
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
            },
            {
                role: 'assistant',
                content:
                    'BinGPT đang được nâng cấp để hỗ trợ bạn tốt hơn. Bạn quay lại sau giúp mình nhé 🙂',
            },
            {
                role: 'assistant',
                content: 'Bạn muốn xem thông tin tài khoản hay thông tin shop?',
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
        expect(mockUnderstanding.understand).toHaveBeenCalledWith({
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
        });
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
        expect(events[1]).toEqual({
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

    // Lỗi thiếu key/provider phải khác câu hỏi chưa rõ để UI không hỏi người dùng diễn đạt lại vô ích.
    it('should tell the user when the AI planner is unavailable', async () => {
        // Arrange
        mockUnderstanding.understand.mockResolvedValue({
            status: 'PLANNER_UNAVAILABLE',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: null,
            failureReason: 'AI_NOT_CONFIGURED',
        });
        const events: SellerCopilotEvent[] = [];
        const request = { message: 'Doanh thu tuần này thế nào?' };
        const preparedChat = await prepareChat(request);

        // Act
        for await (const event of target.execute(preparedChat, request)) {
            events.push(event);
        }

        // Assert
        expect(events[1]).toEqual({
            type: 'token',
            text: 'Hiện tại trợ lý AI chưa sẵn sàng. Bạn quay lại sau giúp mình nhé 🙂',
        });
        expect(mockRepository.saveMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                content:
                    'Hiện tại trợ lý AI chưa sẵn sàng. Bạn quay lại sau giúp mình nhé 🙂',
            }),
        );
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
});
