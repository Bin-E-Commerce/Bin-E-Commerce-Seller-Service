// Kiểm thử biên SSE của controller bằng stream giả; không mở HTTP server hay gọi dịch vụ thật.
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { ConversationHistoryService } from '@/modules/seller-copilot/application/conversation/history/conversation-history.service';
import type { ConversationPersistenceService } from '@/modules/seller-copilot/application/conversation/persistence/conversation-persistence.service';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import type { SellerCopilotChatDto } from '@/modules/seller-copilot/presentation/dto/seller-copilot.dto';
import { SellerCopilotController } from '@/modules/seller-copilot/presentation/controllers/seller-copilot.controller';

describe('SellerCopilotController', () => {
    // Request body đóng không hủy stream; response đóng sớm phải abort use case và không drain generator.
    it('should cancel generation only when the response disconnects', async () => {
        // Arrange
        const mockHistory = {} as ConversationHistoryService;
        const mockPersistence = {} as ConversationPersistenceService;
        const mockStreamCopilot = {
            prepare: jest.fn().mockResolvedValue({
                ownerUserId: 'owner-1',
                shopId: 'shop-1',
                conversationId: 'conversation-1',
            }),
            execute: jest.fn(),
        } as unknown as jest.Mocked<StreamSellerCopilotUseCase>;
        const target = new SellerCopilotController(
            mockHistory,
            mockPersistence,
            mockStreamCopilot,
        );
        const request = Object.assign(new EventEmitter(), {
            headers: { 'x-request-id': 'request-1' },
        });
        const response = Object.assign(new EventEmitter(), {
            writableEnded: false,
            status: jest.fn().mockReturnThis(),
            setHeader: jest.fn().mockReturnThis(),
            flushHeaders: jest.fn(),
            write: jest.fn().mockReturnValue(true),
            end: jest.fn(),
        });
        let generatorClosed = false;
        let signalFromController: AbortSignal | undefined;
        // Request đóng là bình thường; mô phỏng browser đóng response khi generator đang tạo event kế tiếp.
        mockStreamCopilot.execute.mockImplementation(
            async function* (_prepared, _body, _requestId, signal) {
                signalFromController = signal;
                try {
                    yield {
                        type: 'started',
                        conversationId: 'conversation-1',
                        requestId: 'request-1',
                    };
                    request.emit('close');
                    response.emit('close');
                    yield { type: 'token', text: 'Câu trả lời' };
                } finally {
                    generatorClosed = true;
                }
            },
        );

        // Act
        await target.streamChat(
            'owner-1',
            { message: 'Câu hỏi' } as SellerCopilotChatDto,
            request as unknown as Request,
            response as unknown as Response,
        );

        // Assert
        expect(mockStreamCopilot.prepare).toHaveBeenCalledWith('owner-1', {
            message: 'Câu hỏi',
        });
        expect(mockStreamCopilot.execute).toHaveBeenCalledWith(
            {
                ownerUserId: 'owner-1',
                shopId: 'shop-1',
                conversationId: 'conversation-1',
            },
            { message: 'Câu hỏi' },
            'request-1',
            expect.any(AbortSignal),
        );
        expect(response.write).toHaveBeenCalledTimes(1);
        expect(response.write).toHaveBeenCalledWith(
            'event: started\ndata: {"type":"started","conversationId":"conversation-1","requestId":"request-1"}\n\n',
        );
        expect(generatorClosed).toBe(true);
        expect(signalFromController?.aborted).toBe(true);
        expect(response.end).not.toHaveBeenCalled();
    });

    // Nếu browser đóng trong preflight, khi DB trả kết quả controller không được mở stream hoặc gọi planner.
    it('should skip SSE startup when the client disconnects during preflight', async () => {
        // Arrange
        let resolvePreparation!: (value: {
            ownerUserId: string;
            shopId: string;
            conversationId: string;
        }) => void;
        const mockHistory = {} as ConversationHistoryService;
        const mockPersistence = {} as ConversationPersistenceService;
        const mockStreamCopilot = {
            prepare: jest.fn(
                () =>
                    new Promise((resolve) => {
                        resolvePreparation = resolve;
                    }),
            ),
            execute: jest.fn(),
        } as unknown as jest.Mocked<StreamSellerCopilotUseCase>;
        const target = new SellerCopilotController(
            mockHistory,
            mockPersistence,
            mockStreamCopilot,
        );
        const request = Object.assign(new EventEmitter(), {
            headers: { 'x-request-id': 'request-2' },
        });
        const response = Object.assign(new EventEmitter(), {
            writableEnded: false,
            status: jest.fn().mockReturnThis(),
            setHeader: jest.fn().mockReturnThis(),
            flushHeaders: jest.fn(),
            write: jest.fn().mockReturnValue(true),
            end: jest.fn(),
        });

        // Act
        const pending = target.streamChat(
            'owner-1',
            { message: 'Câu hỏi' } as SellerCopilotChatDto,
            request as unknown as Request,
            response as unknown as Response,
        );
        response.emit('close');
        resolvePreparation({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
        });
        await pending;

        // Assert
        expect(response.flushHeaders).not.toHaveBeenCalled();
        expect(mockStreamCopilot.execute).not.toHaveBeenCalled();
        expect(response.end).not.toHaveBeenCalled();
    });
});
