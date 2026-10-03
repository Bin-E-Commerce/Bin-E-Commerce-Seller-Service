// Đo chất lượng planner theo nhiều lát cắt và tách lỗi kỹ thuật khỏi lỗi hiểu nghĩa.
// Báo cáo chỉ giữ nhãn, mã ca và trạng thái; không lưu nội dung hội thoại thực tế.
import type {
    SellerQuestionEvaluationCase,
    SellerQuestionPlan,
} from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';

const MINIMUM_CASES_PER_GROUP = 100;
const REQUIRED_GROUP_ACCURACY = 0.97;
const REQUIRED_TECHNICAL_SUCCESS_RATE = 0.99;

export interface SellerQuestionEvaluationGroup {
    total: number;
    correct: number;
    accuracy: number;
    confidenceInterval95: [number, number] | null;
    gate: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';
}

export interface SellerQuestionEvaluationCaseResult {
    id: string;
    expected: unknown;
    actual: unknown;
    mismatchReasons: string[];
    technicalStatus: SellerQuestionPlan['status'];
    failureReason: SellerQuestionPlan['failureReason'];
    latencyMs: number | null;
    tokenUsage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    } | null;
}

export type SellerQuestionConfusionMatrix = Record<
    string,
    Record<string, number>
>;

export interface SellerQuestionEvaluationReport {
    evaluatedAt: string;
    split: string;
    model: string;
    promptHash: string;
    registryHash: string;
    total: number;
    approvedGoldLabels: number;
    pendingGoldLabels: number;
    semanticCases: number;
    semanticCorrect: number;
    semanticAccuracy: number;
    technicalFailures: number;
    technicalSuccessRate: number;
    groups: {
        requestType: Record<string, SellerQuestionEvaluationGroup>;
        domain: Record<string, SellerQuestionEvaluationGroup>;
        status: Record<string, SellerQuestionEvaluationGroup>;
        contextRelation: Record<string, SellerQuestionEvaluationGroup>;
        taskSegmentation: Record<string, SellerQuestionEvaluationGroup>;
        resolvedQuestionAnchors: Record<string, SellerQuestionEvaluationGroup>;
    };
    confusionMatrices: {
        requestType: SellerQuestionConfusionMatrix;
        domain: SellerQuestionConfusionMatrix;
        status: SellerQuestionConfusionMatrix;
        contextRelation: SellerQuestionConfusionMatrix;
    };
    cases: SellerQuestionEvaluationCaseResult[];
    passed: boolean;
}

export interface SellerQuestionEvaluationObservation {
    plan: SellerQuestionPlan;
    latencyMs?: number;
    tokenUsage?: SellerQuestionEvaluationCaseResult['tokenUsage'];
}

export interface SellerQuestionEvaluationOptions {
    split: string;
    model: string;
    promptHash: string;
    registryHash: string;
    evaluatedAt?: string;
    requiredRequestTypes?: string[];
    requiredDomains?: string[];
}

// Chạy từng ca một lần, so sánh kết quả ngữ nghĩa chính xác và gom lỗi theo request type/domain/context.
// Plan lỗi kỹ thuật bị loại khỏi độ chính xác ngữ nghĩa nhưng vẫn làm giảm riêng technical success rate.
export async function evaluateSellerQuestionCases(
    cases: SellerQuestionEvaluationCase[],
    classify: (
        testCase: SellerQuestionEvaluationCase,
    ) => Promise<SellerQuestionPlan | SellerQuestionEvaluationObservation>,
    options: SellerQuestionEvaluationOptions = {
        split: 'development',
        model: 'unknown',
        promptHash: 'unknown',
        registryHash: 'unknown',
    },
): Promise<SellerQuestionEvaluationReport> {
    const groups: SellerQuestionEvaluationReport['groups'] = {
        requestType: {},
        domain: {},
        status: {},
        contextRelation: {},
        taskSegmentation: {},
        resolvedQuestionAnchors: {},
    };
    // Tạo trước các nhóm registry để nhóm không có mẫu cũng hiện INSUFFICIENT_DATA, không biến mất khỏi report.
    for (const requestType of options.requiredRequestTypes ?? []) {
        groups.requestType[requestType] = createEmptyGroup();
    }
    for (const domain of options.requiredDomains ?? []) {
        groups.domain[domain] = createEmptyGroup();
    }
    for (const status of ['READY', 'NEEDS_CLARIFICATION', 'OUT_OF_SCOPE']) {
        groups.status[status] = createEmptyGroup();
    }
    for (const relation of ['NEW_TOPIC', 'FOLLOW_UP', 'CLARIFICATION_REPLY']) {
        groups.contextRelation[relation] = createEmptyGroup();
    }
    for (const slice of ['SINGLE_TASK', 'MULTI_TASK', 'CLARIFICATION']) {
        groups.taskSegmentation[slice] = createEmptyGroup();
    }
    groups.resolvedQuestionAnchors.CONTEXT_ANCHORS = createEmptyGroup();
    const caseResults: SellerQuestionEvaluationCaseResult[] = [];
    const confusionMatrices = {
        requestType: {},
        domain: {},
        status: {},
        contextRelation: {},
    } satisfies SellerQuestionEvaluationReport['confusionMatrices'];
    let semanticCorrect = 0;
    let semanticCases = 0;
    let technicalFailures = 0;

    // Tuần tự hóa lời gọi giúp evaluator có thể dự đoán tải và chi phí của provider.
    for (const testCase of cases) {
        const startedAt = Date.now();
        const result = await classify(testCase);
        const observation: SellerQuestionEvaluationObservation =
            isObservation(result) ? result : { plan: result };
        observation.latencyMs ??= Date.now() - startedAt;

        const { plan } = observation;
        const mismatchReasons = getMismatchReasons(testCase, plan);
        const isTechnicalFailure = isTechnicalFailurePlan(plan);
        if (isTechnicalFailure) {
            technicalFailures += 1;
        } else {
            semanticCases += 1;
            if (mismatchReasons.length === 0) semanticCorrect += 1;
            collectGroupResults(groups, testCase, plan);
            collectConfusionMatrices(confusionMatrices, testCase, plan);
        }

        caseResults.push({
            id: testCase.id,
            expected: testCase.expected,
            actual: toComparablePlan(plan),
            mismatchReasons,
            technicalStatus: plan.status,
            failureReason: plan.failureReason,
            latencyMs: observation.latencyMs ?? null,
            tokenUsage: observation.tokenUsage ?? null,
        });
    }

    // Tính confidence interval Wilson để điểm mẫu nhỏ không bị hiểu như cam kết chắc chắn.
    finalizeGroups(groups);
    const semanticAccuracy = semanticCases
        ? semanticCorrect / semanticCases
        : 0;
    const technicalSuccessRate = cases.length
        ? (cases.length - technicalFailures) / cases.length
        : 0;
    const approvedGoldLabels = cases.filter(
        ({ reviewStatus }) => reviewStatus === 'APPROVED',
    ).length;
    const pendingGoldLabels = cases.length - approvedGoldLabels;
    const requiredRequestTypes = options.requiredRequestTypes ?? [];
    const requiredDomains = options.requiredDomains ?? [];

    // Chỉ request type/domain là điều kiện nghiệm thu; các lát cắt còn lại giúp chẩn đoán mà không đòi mẫu tối thiểu riêng.
    const requiredTaxonomyGroupsPass =
        requiredRequestTypes.length > 0 &&
        requiredDomains.length > 0 &&
        requiredRequestTypes.every(
            (requestType) =>
                groups.requestType[requestType]?.gate === 'PASS',
        ) &&
        requiredDomains.every(
            (domain) => groups.domain[domain]?.gate === 'PASS',
        );

    // Chỉ holdout độc lập, đủ nhãn duyệt/lý do và ID duy nhất mới được dùng để kết luận đạt.
    const approvedHoldout =
        options.split === 'holdout' &&
        new Set(cases.map(({ id }) => id)).size === cases.length &&
        cases.every(
            (testCase) =>
                testCase.split === 'holdout' &&
                testCase.reviewStatus === 'APPROVED' &&
                Boolean(testCase.labelRationale?.trim()),
        );

    return {
        evaluatedAt: options.evaluatedAt ?? new Date().toISOString(),
        split: options.split,
        model: options.model,
        promptHash: options.promptHash,
        registryHash: options.registryHash,
        total: cases.length,
        approvedGoldLabels,
        pendingGoldLabels,
        semanticCases,
        semanticCorrect,
        semanticAccuracy,
        technicalFailures,
        technicalSuccessRate,
        groups,
        confusionMatrices,
        cases: caseResults,
        passed:
            cases.length > 0 &&
            approvedHoldout &&
            technicalSuccessRate >= REQUIRED_TECHNICAL_SUCCESS_RATE &&
            semanticAccuracy > REQUIRED_GROUP_ACCURACY &&
            requiredTaxonomyGroupsPass,
    };
}

// Ghi expected→actual cho từng trục để thấy rõ cặp nhãn nào bị nhầm thay vì chỉ xem tổng accuracy.
function collectConfusionMatrices(
    matrices: SellerQuestionEvaluationReport['confusionMatrices'],
    testCase: SellerQuestionEvaluationCase,
    actual: SellerQuestionPlan,
): void {
    incrementConfusion(
        matrices.status,
        testCase.expected.status,
        actual.status,
    );
    incrementConfusion(
        matrices.contextRelation,
        testCase.expected.contextRelation,
        actual.contextRelation,
    );
    const taskCount = Math.max(
        testCase.expected.tasks.length,
        actual.tasks.length,
    );
    for (let index = 0; index < taskCount; index += 1) {
        const expectedTask = testCase.expected.tasks[index];
        const actualTask = actual.tasks[index];
        incrementConfusion(
            matrices.requestType,
            expectedTask?.requestType ?? 'NO_EXPECTED_TASK',
            actualTask?.requestType ?? 'MISSING_TASK',
        );
        incrementConfusion(
            matrices.domain,
            expectedTask?.domain ??
                (expectedTask ? 'NO_DOMAIN' : 'NO_EXPECTED_TASK'),
            actualTask?.domain ?? (actualTask ? 'NO_DOMAIN' : 'MISSING_TASK'),
        );
    }
}

// Ma trận lưu số lần mỗi nhãn kỳ vọng đi tới một nhãn thực tế, kể cả nhãn thiếu/thừa task.
function incrementConfusion(
    matrix: SellerQuestionConfusionMatrix,
    expected: string,
    actual: string,
): void {
    const row = (matrix[expected] ??= {});
    row[actual] = (row[actual] ?? 0) + 1;
}

// Khởi tạo nhóm chưa có mẫu để evaluator báo thiếu dữ liệu một cách tường minh.
function createEmptyGroup(): SellerQuestionEvaluationGroup {
    return {
        total: 0,
        correct: 0,
        accuracy: 0,
        confidenceInterval95: null,
        gate: 'INSUFFICIENT_DATA',
    };
}

// So sánh từng trục riêng để báo chính xác model nhầm mục đích, domain, thứ tự task hay ngữ cảnh.
function collectGroupResults(
    groups: SellerQuestionEvaluationReport['groups'],
    testCase: SellerQuestionEvaluationCase,
    actual: SellerQuestionPlan,
): void {
    const expected = testCase.expected;
    recordGroup(
        groups.status,
        expected.status,
        actual.status === expected.status,
    );
    recordGroup(
        groups.contextRelation,
        expected.contextRelation,
        actual.contextRelation === expected.contextRelation,
    );

    const segmentationCorrect =
        actual.tasks.length === expected.tasks.length &&
        actual.tasks.every((task, index) => {
            const expectedTask = expected.tasks[index];
            return (
                task.requestType === expectedTask?.requestType &&
                task.domain === expectedTask?.domain
            );
        });
    recordGroup(
        groups.taskSegmentation,
        expected.tasks.length > 1
            ? 'MULTI_TASK'
            : expected.status === 'NEEDS_CLARIFICATION'
              ? 'CLARIFICATION'
              : 'SINGLE_TASK',
        segmentationCorrect,
    );

    // Mỗi request type/domain chỉ nhận tối đa một phiếu cho mỗi câu, tránh câu nhiều task làm phình mẫu và CI.
    const expectedRequestTypes = new Set(
        expected.tasks.map(({ requestType }) => requestType),
    );
    for (const requestType of expectedRequestTypes) {
        const matchingTasks = expected.tasks
            .map((task, index) => ({ task, actualTask: actual.tasks[index] }))
            .filter(({ task }) => task.requestType === requestType);
        recordGroup(
            groups.requestType,
            requestType,
            matchingTasks.every(
                ({ actualTask }) => actualTask?.requestType === requestType,
            ),
        );
    }

    const expectedDomains = new Set(
        expected.tasks.map(({ domain }) => domain ?? 'NO_DOMAIN'),
    );
    for (const domain of expectedDomains) {
        const matchingTasks = expected.tasks
            .map((task, index) => ({ task, actualTask: actual.tasks[index] }))
            .filter(({ task }) => (task.domain ?? 'NO_DOMAIN') === domain);
        recordGroup(
            groups.domain,
            domain,
            matchingTasks.every(
                ({ task, actualTask }) => actualTask?.domain === task.domain,
            ),
        );
    }

    // Anchor là lát cắt theo câu hỏi: câu có nhiều mốc vẫn chỉ đóng góp một quan sát.
    const tasksWithAnchors = expected.tasks.flatMap((task, index) => {
        const anchors = task.resolvedQuestionMustContain ?? [];
        return anchors.length
            ? [{ anchors, actualTask: actual.tasks[index] }]
            : [];
    });
    if (tasksWithAnchors.length > 0) {
        const anchorsPreserved = tasksWithAnchors.every(
            ({ anchors, actualTask }) => {
                const resolved = actualTask?.resolvedQuestion.toLocaleLowerCase(
                    'vi',
                );
                return (
                    resolved !== undefined &&
                    anchors.every((anchor) =>
                        resolved.includes(anchor.toLocaleLowerCase('vi')),
                    )
                );
            },
        );
        recordGroup(
            groups.resolvedQuestionAnchors,
            'CONTEXT_ANCHORS',
            anchorsPreserved,
        );
    }
}

// Ghi nhận mỗi ca vào đúng lát cắt; finalization gán gate sau khi đã gom đủ mẫu.
function recordGroup(
    groups: Record<string, SellerQuestionEvaluationGroup>,
    name: string,
    correct: boolean,
): void {
    const group = (groups[name] ??= {
        total: 0,
        correct: 0,
        accuracy: 0,
        confidenceInterval95: null,
        gate: 'INSUFFICIENT_DATA',
    });
    group.total += 1;
    if (correct) group.correct += 1;
}

// Tính điểm, khoảng tin cậy và điều kiện >97%; nhóm ít hơn 100 ca không thể được đánh dấu đạt.
function finalizeGroups(
    groups: SellerQuestionEvaluationReport['groups'],
): void {
    for (const grouping of Object.values(groups)) {
        for (const group of Object.values(grouping)) {
            group.accuracy = group.total ? group.correct / group.total : 0;
            group.confidenceInterval95 = wilsonInterval(
                group.correct,
                group.total,
            );
            group.gate =
                group.total < MINIMUM_CASES_PER_GROUP
                    ? 'INSUFFICIENT_DATA'
                    : group.accuracy > REQUIRED_GROUP_ACCURACY
                      ? 'PASS'
                      : 'FAIL';
        }
    }
}

// Wilson interval cho tỷ lệ nhị thức, ổn định hơn xấp xỉ chuẩn khi mẫu nhỏ hoặc accuracy gần 100%.
function wilsonInterval(
    correct: number,
    total: number,
): [number, number] | null {
    if (total === 0) return null;
    const z = 1.96;
    const proportion = correct / total;
    const denominator = 1 + z ** 2 / total;
    const center = (proportion + z ** 2 / (2 * total)) / denominator;
    const margin =
        (z *
            Math.sqrt(
                (proportion * (1 - proportion) + z ** 2 / (4 * total)) / total,
            )) /
        denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

// Nêu rõ từng phần lệch mà không đưa nội dung câu hỏi hay dữ liệu hồ sơ vào báo cáo.
function getMismatchReasons(
    testCase: SellerQuestionEvaluationCase,
    actual: SellerQuestionPlan,
): string[] {
    const reasons: string[] = [];
    const expected = testCase.expected;
    if (isTechnicalFailurePlan(actual)) {
        return [`TECHNICAL_FAILURE:${actual.failureReason ?? actual.status}`];
    }
    if (actual.status !== expected.status) reasons.push('STATUS_MISMATCH');
    if (actual.contextRelation !== expected.contextRelation) {
        reasons.push('CONTEXT_RELATION_MISMATCH');
    }
    if (actual.tasks.length !== expected.tasks.length) {
        reasons.push('TASK_COUNT_MISMATCH');
    }
    if (
        actual.tasks.length === expected.tasks.length &&
        actual.tasks.some((task, index) => {
            const expectedTask = expected.tasks[index];
            return (
                task.requestType !== expectedTask?.requestType ||
                task.domain !== expectedTask?.domain
            );
        })
    ) {
        reasons.push('TASK_ORDER_OR_CLASSIFICATION_MISMATCH');
    }
    expected.tasks.forEach((task, index) => {
        const actualTask = actual.tasks[index];
        if (!actualTask) return;
        if (actualTask.requestType !== task.requestType) {
            reasons.push(`TASK_${index + 1}_REQUEST_TYPE_MISMATCH`);
        }
        if (actualTask.domain !== task.domain) {
            reasons.push(`TASK_${index + 1}_DOMAIN_MISMATCH`);
        }
        if (!actualTask.resolvedQuestion.trim()) {
            reasons.push(`TASK_${index + 1}_RESOLVED_QUESTION_EMPTY`);
        }
        if (
            task.resolvedQuestionMustContain?.some(
                (anchor) =>
                    !actualTask.resolvedQuestion
                        .toLocaleLowerCase('vi')
                        .includes(anchor.toLocaleLowerCase('vi')),
            )
        ) {
            reasons.push(`TASK_${index + 1}_CONTEXT_ANCHOR_LOST`);
        }
    });
    return reasons;
}

// Chỉ xuất các trường phục vụ chẩn đoán; resolvedQuestion không được ghi vào report vì có thể chứa dữ liệu nhạy cảm.
function toComparablePlan(plan: SellerQuestionPlan): unknown {
    return {
        status: plan.status,
        contextRelation: plan.contextRelation,
        tasks: plan.tasks.map(({ requestType, domain, resolvedQuestion }) => ({
            requestType,
            domain,
            resolvedQuestionNonEmpty: Boolean(resolvedQuestion.trim()),
        })),
    };
}

// Provider failure/invalid output không được tính vào độ chính xác ngữ nghĩa, nhưng vẫn nằm trong success-rate kỹ thuật.
function isTechnicalFailurePlan(plan: SellerQuestionPlan): boolean {
    return (
        plan.status === 'PLANNER_UNAVAILABLE' ||
        plan.status === 'PLANNER_INVALID_RESPONSE'
    );
}

// Cho phép evaluator nhận thêm số đo provider mà không làm thay đổi kết quả use case production.
function isObservation(
    value: SellerQuestionPlan | SellerQuestionEvaluationObservation,
): value is SellerQuestionEvaluationObservation {
    return 'plan' in value;
}
