import { Test, TestingModule } from '@nestjs/testing';
import {
    SELLER_QUESTION_CAPABILITY_REGISTRY,
    type SellerQuestionCapabilityRegistry,
} from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.util';
import {
    SELLER_QUESTION_PLANNER,
    type SellerQuestionPlannerPort,
} from '@/modules/seller-copilot/application/question-understanding/shared/planner/contracts/seller-question-planner.port';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/shared/planner/seller-question-understanding.service';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('SellerQuestionUnderstandingService', () => {
    let target: SellerQuestionUnderstandingService;
    let module: TestingModule;
    let registry: SellerQuestionCapabilityRegistry;
    let mockPlanner: jest.Mocked<SellerQuestionPlannerPort>;

    beforeEach(async () => {
        // Arrange: dependency AI được thay bằng mock để unit test không gọi mạng hoặc tiêu tốn token.
        registry = validateSellerQuestionCapabilityRegistry(
            JSON.parse(
                readFileSync(
                    resolve(
                        process.cwd(),
                        'data/seller-knowledge/capability-registry.json',
                    ),
                    'utf8',
                ),
            ) as unknown,
        );
        mockPlanner = {
            classify: jest.fn(),
        };
        module = await Test.createTestingModule({
            providers: [
                SellerQuestionUnderstandingService,
                { provide: SELLER_QUESTION_PLANNER, useValue: mockPlanner },
                {
                    provide: SELLER_QUESTION_CAPABILITY_REGISTRY,
                    useValue: {
                        getActiveRegistry: jest
                            .fn()
                            .mockResolvedValue(registry),
                    },
                },
            ],
        }).compile();
        target = module.get(SellerQuestionUnderstandingService);
    });

    afterEach(async () => {
        // Dọn provider test module và mock giữa các ca để kết quả độc lập.
        await module.close();
        jest.clearAllMocks();
    });

    it('should return a validated plan after exactly one planner request', async () => {
        // Arrange
        mockPlanner.classify.mockResolvedValue({
            kind: 'success',
            response: {
                status: 'READY',
                contextRelation: 'NEW_TOPIC',
                tasks: [
                    {
                        requestType: 'READ_QUERY',
                        domain: 'restricted-products',
                        resolvedQuestion: 'Những sản phẩm nào bị hạn chế bán?',
                    },
                ],
                clarificationQuestion: null,
            },
        });

        // Act
        const result = await target.understand({
            question: 'Có mặt hàng nào không được bán không?',
        });

        // Assert
        expect(result.status).toBe('READY');
        expect(mockPlanner.classify).toHaveBeenCalledTimes(1);
        expect(mockPlanner.classify).toHaveBeenCalledWith(
            expect.objectContaining({
                question: 'Có mặt hàng nào không được bán không?',
            }),
        );
    });

    it('should distinguish missing AI configuration from an unclear user question', async () => {
        // Arrange
        mockPlanner.classify.mockResolvedValue({
            kind: 'failure',
            reason: 'AI_NOT_CONFIGURED',
        });

        // Act
        const result = await target.understand({ question: 'Bạn ơi' });

        // Assert
        expect(result).toEqual<SellerQuestionPlan>({
            status: 'PLANNER_UNAVAILABLE',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: null,
            failureReason: 'AI_NOT_CONFIGURED',
        });
    });

    it('should not call the model for an empty question', async () => {
        // Arrange, Act
        const result = await target.understand({ question: '   ' });

        // Assert
        expect(result.status).toBe('NEEDS_CLARIFICATION');
        expect(mockPlanner.classify).not.toHaveBeenCalled();
    });

    it('should turn an invalid model plan into a typed planner failure', async () => {
        // Arrange
        mockPlanner.classify.mockResolvedValue({
            kind: 'success',
            response: {
                status: 'READY',
                tasks: [{ requestType: 'UNKNOWN' }],
            },
        });

        // Act
        const result = await target.understand({ question: 'Hỏi gì đó' });

        // Assert
        expect(result.status).toBe('PLANNER_INVALID_RESPONSE');
        expect(result.failureReason).toBe('AI_INVALID_RESPONSE');
    });
});
