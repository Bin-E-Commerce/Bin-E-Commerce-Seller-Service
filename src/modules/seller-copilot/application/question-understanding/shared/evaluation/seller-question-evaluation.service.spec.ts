// Kiểm tra evaluator phân biệt lỗi ngữ nghĩa, lỗi kỹ thuật và nhóm thiếu mẫu holdout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateSellerQuestionCases } from '@/modules/seller-copilot/application/question-understanding/shared/evaluation/seller-question-evaluation.service';
import type {
    SellerQuestionEvaluationCase,
    SellerQuestionPlan,
} from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

describe('evaluateSellerQuestionCases', () => {
    const cases = JSON.parse(
        readFileSync(
            resolve(
                process.cwd(),
                'data/seller-question-evaluation/cases/development-cases.json',
            ),
            'utf8',
        ),
    ) as SellerQuestionEvaluationCase[];
    const fiveRouteCases = JSON.parse(
        readFileSync(
            resolve(
                process.cwd(),
                'data/seller-question-evaluation/cases/five-routes-cases.json',
            ),
            'utf8',
        ),
    ) as SellerQuestionEvaluationCase[];

    // Bộ route phải cân bằng đủ năm luồng, giữ mode agent tường minh và không tự nhận nhãn đã duyệt.
    it('should provide balanced diagnostic cases for the five BinGPT entry routes', () => {
        const routes = [
            'CONVERSATION',
            'PROFILE',
            'LIVE_DATA',
            'KNOWLEDGE',
            'AGENT_INVENTORY',
        ];
        const routeCounts = Object.fromEntries(
            routes.map((route) => [
                route,
                fiveRouteCases.filter(
                    ({ expectedRoute }) => expectedRoute === route,
                ).length,
            ]),
        );

        expect(fiveRouteCases).toHaveLength(50);
        expect(new Set(fiveRouteCases.map(({ id }) => id)).size).toBe(50);
        expect(routeCounts).toEqual({
            CONVERSATION: 10,
            PROFILE: 10,
            LIVE_DATA: 10,
            KNOWLEDGE: 10,
            AGENT_INVENTORY: 10,
        });
        expect(
            fiveRouteCases.filter(
                ({ interactionMode }) => interactionMode === 'agent',
            ),
        ).toHaveLength(10);
        expect(
            fiveRouteCases.every(
                ({ reviewStatus }) => reviewStatus === 'PENDING_REVIEW',
            ),
        ).toBe(true);
    });

    // Chấm đúng gate category từ task và mode đầu vào; không coi câu lệnh tồn kho trong chat là agent.
    it('should score all five entry routes separately from request type and domain', async () => {
        const report = await evaluateSellerQuestionCases(
            fiveRouteCases,
            async (testCase) => planFromCase(testCase),
            {
                ...evaluationOptions,
                split: 'five-routes',
            },
        );

        expect(report.semanticAccuracy).toBe(1);
        for (const route of [
            'CONVERSATION',
            'PROFILE',
            'LIVE_DATA',
            'KNOWLEDGE',
            'AGENT_INVENTORY',
        ]) {
            expect(report.groups.routeCategory[route]).toMatchObject({
                total: 10,
                correct: 10,
                accuracy: 1,
                gate: 'INSUFFICIENT_DATA',
            });
            expect(report.confusionMatrices.routeCategory[route]?.[route]).toBe(
                10,
            );
        }
    });

    // Bộ 100 ca cũ là development, không được dùng làm bằng chứng holdout đã duyệt.
    it('should contain one hundred unique development cases across request types', () => {
        const ids = new Set(cases.map(({ id }) => id));
        const requestTypes = new Set(
            cases.flatMap(({ expected }) =>
                expected.tasks.map(({ requestType }) => requestType),
            ),
        );

        expect(cases).toHaveLength(100);
        expect(ids.size).toBe(100);
        expect(requestTypes.size).toBeGreaterThanOrEqual(4);
        expect(
            cases.every(({ labelRationale }) =>
                Boolean(labelRationale?.trim()),
            ),
        ).toBe(true);
        expect(
            cases.every(
                ({ reviewStatus }) => reviewStatus === 'PENDING_REVIEW',
            ),
        ).toBe(true);
        expect(
            cases.find(({ id }) => id === 'CP06')?.expected.tasks[0]
                ?.requestType,
        ).toBe('CAPABILITY_QUERY');
        expect(
            cases.find(({ id }) => id === 'LD13')?.expected.tasks[0]?.domain,
        ).toBe('seller-revenue');
        expect(
            cases.find(({ id }) => id === 'PL17')?.expected.tasks[0]?.domain,
        ).toBe('shipping');
        expect(cases.find(({ id }) => id === 'SA06')).toMatchObject({
            expected: {
                status: 'READY',
                contextRelation: 'CLARIFICATION_REPLY',
                tasks: [
                    { requestType: 'READ_QUERY', domain: 'seller-profile' },
                ],
            },
        });
    });

    // Đúng 100/100 development vẫn không thể vượt gate nếu từng domain thiếu 100 mẫu holdout.
    it('should report perfect development accuracy without claiming the holdout gate passed', async () => {
        const report = await evaluateSellerQuestionCases(
            cases,
            async (testCase) => planFromCase(testCase),
            evaluationOptions,
        );

        expect(report.total).toBe(100);
        expect(report.semanticCorrect).toBe(100);
        expect(report.semanticAccuracy).toBe(1);
        expect(report.groups.requestType.READ_QUERY?.gate).toBe(
            'INSUFFICIENT_DATA',
        );
        expect(report.groups.domain.shipping?.gate).toBe('INSUFFICIENT_DATA');
        expect(
            report.confusionMatrices.requestType.READ_QUERY?.READ_QUERY,
        ).toBeGreaterThan(0);
        expect(report.passed).toBe(false);
        expect(report.cases[0]).toMatchObject({
            id: cases[0]?.id,
            latencyMs: expect.any(Number),
            tokenUsage: null,
        });
    });

    // Task nhiều ý được chấm đúng thứ tự; tráo thứ tự phải làm nhóm segmentation thất bại.
    it('should identify task ordering errors in the segmentation slice', async () => {
        const multiTaskCase = cases.find(
            ({ expected }) =>
                expected.tasks.length > 1 &&
                expected.tasks.some(
                    (task, index) =>
                        index < expected.tasks.length - 1 &&
                        (task.requestType !==
                            expected.tasks[index + 1]?.requestType ||
                            task.domain !== expected.tasks[index + 1]?.domain),
                ),
        );
        expect(multiTaskCase).toBeDefined();

        const report = await evaluateSellerQuestionCases(
            [multiTaskCase!],
            async (testCase) => ({
                ...planFromCase(testCase),
                tasks: planFromCase(testCase).tasks.reverse(),
            }),
            evaluationOptions,
        );

        expect(report.groups.taskSegmentation.MULTI_TASK?.correct).toBe(0);
        expect(report.cases[0]?.mismatchReasons).toContain(
            'TASK_ORDER_OR_CLASSIFICATION_MISMATCH',
        );
    });

    // Provider failure bị loại khỏi accuracy ngữ nghĩa nhưng vẫn giảm technical success rate.
    it('should separate provider errors from semantic classification accuracy', async () => {
        const [testCase] = cases;
        const report = await evaluateSellerQuestionCases(
            [testCase!],
            async () => ({
                plan: {
                    status: 'PLANNER_UNAVAILABLE',
                    contextRelation: 'NEW_TOPIC',
                    tasks: [],
                    clarificationQuestion: null,
                    failureReason: 'AI_PROVIDER_ERROR',
                },
                tokenUsage: {
                    promptTokens: 20,
                    completionTokens: 3,
                    totalTokens: 23,
                },
            }),
            evaluationOptions,
        );

        expect(report.semanticCases).toBe(0);
        expect(report.technicalFailures).toBe(1);
        expect(report.technicalSuccessRate).toBe(0);
        expect(report.cases[0]?.mismatchReasons).toContain(
            'TECHNICAL_FAILURE:AI_PROVIDER_ERROR',
        );
        expect(report.cases[0]?.tokenUsage).toEqual({
            promptTokens: 20,
            completionTokens: 3,
            totalTokens: 23,
        });
    });

    // Mỗi câu nhiều ý chỉ đóng góp một mẫu cho từng nhãn; lát cắt chẩn đoán không chặn gate taxonomy.
    it('should count independent holdout cases and gate only request types and domains', async () => {
        const holdoutCases = createHoldoutCases('APPROVED');
        const report = await evaluateSellerQuestionCases(
            holdoutCases,
            async (testCase) => planFromCase(testCase),
            holdoutEvaluationOptions,
        );

        expect(report.groups.requestType.READ_QUERY).toMatchObject({
            total: 100,
            correct: 100,
            gate: 'PASS',
        });
        expect(report.groups.domain['seller-products-inventory']).toMatchObject(
            {
                total: 100,
                correct: 100,
                gate: 'PASS',
            },
        );
        expect(
            report.groups.resolvedQuestionAnchors.CONTEXT_ANCHORS?.gate,
        ).toBe('INSUFFICIENT_DATA');
        expect(report.passed).toBe(true);
    });

    // Nhãn chưa được duyệt không thể tạo kết luận PASS dù plan phân loại đúng toàn bộ ca.
    it('should reject holdout acceptance when any gold label is pending review', async () => {
        const holdoutCases = createHoldoutCases('PENDING_REVIEW');
        const report = await evaluateSellerQuestionCases(
            holdoutCases,
            async (testCase) => planFromCase(testCase),
            holdoutEvaluationOptions,
        );

        expect(report.approvedGoldLabels).toBe(0);
        expect(report.pendingGoldLabels).toBe(100);
        expect(report.groups.requestType.READ_QUERY?.gate).toBe('PASS');
        expect(report.passed).toBe(false);
    });

    // Task thừa không được lọt qua gate chỉ vì mọi nhãn kỳ vọng vẫn khớp với task cùng vị trí.
    it('should reject holdout acceptance when exact-plan accuracy is below the target', async () => {
        const holdoutCases = createHoldoutCases('APPROVED');
        const report = await evaluateSellerQuestionCases(
            holdoutCases,
            async (testCase) => ({
                ...planFromCase(testCase),
                tasks: [
                    ...planFromCase(testCase).tasks,
                    {
                        requestType: 'READ_QUERY',
                        domain: 'seller-orders',
                        resolvedQuestion: 'Đơn hàng nào cần xử lý?',
                    },
                ],
            }),
            holdoutEvaluationOptions,
        );

        expect(report.groups.requestType.READ_QUERY?.gate).toBe('PASS');
        expect(report.groups.domain['seller-products-inventory']?.gate).toBe(
            'PASS',
        );
        expect(report.semanticAccuracy).toBe(0);
        expect(report.passed).toBe(false);
    });

    // Lỗi lập trình/harness phải hiện ra, không bị gắn nhầm nhãn lỗi provider trong báo cáo.
    it('should propagate unexpected evaluator callback errors', async () => {
        const [testCase] = cases;

        await expect(
            evaluateSellerQuestionCases(
                [testCase!],
                async () => {
                    throw new Error('Unexpected harness failure');
                },
                evaluationOptions,
            ),
        ).rejects.toThrow('Unexpected harness failure');
    });
});

// Tạo plan chính xác từ fixture để kiểm tra evaluator mà không gọi API.
function planFromCase(
    testCase: SellerQuestionEvaluationCase,
): SellerQuestionPlan {
    return {
        status: testCase.expected.status,
        contextRelation: testCase.expected.contextRelation,
        tasks: testCase.expected.tasks.map((task) => ({
            requestType: task.requestType,
            domain: task.domain,
            resolvedQuestion: [
                testCase.question,
                ...(task.resolvedQuestionMustContain ?? []),
            ].join(' '),
        })),
        clarificationQuestion:
            testCase.expected.status === 'NEEDS_CLARIFICATION'
                ? 'Bạn có thể nói rõ hơn không?'
                : null,
        failureReason: null,
    };
}

// Tạo holdout tổng hợp với hai task cùng nhãn để kiểm thử cách đếm theo câu, không dùng làm bằng chứng nghiệp vụ thật.
function createHoldoutCases(
    reviewStatus: 'PENDING_REVIEW' | 'APPROVED',
): SellerQuestionEvaluationCase[] {
    return Array.from({ length: 100 }, (_, index) => ({
        id: `HOLDOUT-${index + 1}`,
        question: `Kiểm thử tồn kho độc lập ${index + 1}`,
        split: 'holdout' as const,
        reviewStatus,
        labelRationale: 'Nhãn tổng hợp chỉ phục vụ kiểm thử evaluator.',
        expected: {
            status: 'READY' as const,
            contextRelation: 'NEW_TOPIC' as const,
            tasks: [
                {
                    requestType: 'READ_QUERY' as const,
                    domain: 'seller-products-inventory',
                },
                {
                    requestType: 'READ_QUERY' as const,
                    domain: 'seller-products-inventory',
                },
            ],
        },
    }));
}

const evaluationOptions = {
    split: 'development',
    model: 'unit-test',
    promptHash: 'test-prompt-hash',
    registryHash: 'test-registry-hash',
    requiredRequestTypes: [
        'SMALL_TALK',
        'CAPABILITY_QUERY',
        'READ_QUERY',
        'CHANGE_REQUEST',
        'OUT_OF_SCOPE',
    ],
    requiredDomains: ['shipping'],
};

const holdoutEvaluationOptions = {
    ...evaluationOptions,
    split: 'holdout',
    requiredRequestTypes: ['READ_QUERY'],
    requiredDomains: ['seller-products-inventory'],
};
