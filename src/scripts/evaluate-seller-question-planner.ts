// Chạy benchmark development, realistic, boundary-stress hoặc holdout độc lập; report không chứa câu hỏi thô.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { buildSellerQuestionContext } from '@/modules/seller-copilot/application/question-understanding/context/seller-question-context.util';
import { evaluateSellerQuestionCases } from '@/modules/seller-copilot/application/question-understanding/evaluation/seller-question-evaluation.service';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import type { SellerQuestionEvaluationCase } from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';
import { validateSellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/planner/validation/seller-question-plan.validator';
import {
    OpenAiSellerQuestionPlannerClient,
    buildSellerQuestionPlannerInstructions,
} from '@/modules/seller-copilot/infrastructure/clients/openai-seller-question-planner.client';
import { loadSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/infrastructure/registry/load-seller-question-capability-registry';

const root = process.cwd();
type EvaluationSplit =
    | 'development'
    | 'realistic'
    | 'boundary-stress'
    | 'holdout';
const evaluationFixtures: Record<EvaluationSplit, string> = {
    development: 'data/seller-question-evaluation/cases/development-cases.json',
    realistic: 'data/seller-question-evaluation/cases/realistic-cases.json',
    'boundary-stress':
        'data/seller-question-evaluation/cases/boundary-stress-cases.json',
    holdout: 'data/seller-question-evaluation/cases/holdout-cases.json',
};

// Chọn tập dữ liệu tường minh; split lạ phải dừng thay vì âm thầm chạy nhầm development.
const requestedSplit =
    process.argv.find((argument) => argument.startsWith('--split='))?.slice(8) ??
    'development';
if (!Object.hasOwn(evaluationFixtures, requestedSplit)) {
    throw new Error(
        `Unknown evaluation split "${requestedSplit}". Use development, realistic, boundary-stress, or holdout.`,
    );
}
const split = requestedSplit as EvaluationSplit;
const fixturePath = resolve(root, evaluationFixtures[split]);

for (const envPath of [
    join(root, '.env.local'),
    join(root, '.env'),
    join(root, '..', '..', '.env'),
]) {
    if (existsSync(envPath)) loadEnvFile(envPath);
}

const fixtures = JSON.parse(
    readFileSync(fixturePath, 'utf8'),
) as SellerQuestionEvaluationCase[];

// Kiểm tra nhãn, tính duy nhất và cặp requestType/domain trước khi tốn chi phí gọi model.
function validateEvaluationFixture(
    cases: SellerQuestionEvaluationCase[],
    registry: SellerQuestionCapabilityRegistry,
    selectedSplit: EvaluationSplit,
): void {
    if (!Array.isArray(cases)) {
        throw new Error('Evaluation fixture must be a JSON array.');
    }
    const ids = new Set(cases.map((testCase) => testCase.id));
    if (ids.size !== cases.length) {
        throw new Error('Evaluation case IDs must be unique.');
    }
    for (const testCase of cases) {
        if (!testCase.question.trim() || !testCase.expected) {
            throw new Error(`Evaluation case ${testCase.id} is incomplete.`);
        }
        if (testCase.split && testCase.split !== selectedSplit) {
            throw new Error(
                `Evaluation case ${testCase.id} belongs to ${testCase.split}, not ${selectedSplit}.`,
            );
        }
        if (
            selectedSplit === 'holdout' &&
            (testCase.reviewStatus !== 'APPROVED' ||
                !testCase.labelRationale?.trim())
        ) {
            throw new Error(
                `Holdout case ${testCase.id} needs an approved label and rationale.`,
            );
        }

        const expectedPlan = validateSellerQuestionPlan(
            {
                ...testCase.expected,
                tasks: testCase.expected.tasks.map(
                    ({ requestType, domain }) => ({
                        requestType,
                        domain,
                        resolvedQuestion: testCase.question,
                    }),
                ),
                clarificationQuestion:
                    testCase.expected.status === 'NEEDS_CLARIFICATION'
                        ? 'Bạn có thể nói rõ hơn không?'
                        : null,
            },
            registry,
        );
        if (!expectedPlan) {
            throw new Error(
                `Evaluation case ${testCase.id} does not match the request-type/domain registry.`,
            );
        }
    }
}

// In đầy đủ các lát cắt và gate status để thiếu holdout không bị hiểu nhầm là accuracy thấp hoặc đã đạt.
function printReport(
    report: Awaited<ReturnType<typeof evaluateSellerQuestionCases>>,
): void {
    // Development/realistic chỉ phục vụ chẩn đoán; chỉ holdout mới được gắn PASS/NOT PASS nghiệm thu.
    const outcome =
        report.split === 'holdout'
            ? report.passed
                ? 'PASS'
                : 'NOT PASS'
            : 'DIAGNOSTIC';
    console.log(
        `${report.split}: ${report.semanticCorrect}/${report.semanticCases} semantic-correct; technical success ${(report.technicalSuccessRate * 100).toFixed(1)}%; labels approved/pending ${report.approvedGoldLabels}/${report.pendingGoldLabels}; ${outcome}`,
    );
    for (const [dimension, grouping] of Object.entries(report.groups)) {
        console.log(`\n${dimension}`);
        for (const [name, group] of Object.entries(grouping)) {
            const interval = group.confidenceInterval95
                ? `, 95% CI ${(group.confidenceInterval95[0] * 100).toFixed(1)}–${(group.confidenceInterval95[1] * 100).toFixed(1)}%`
                : '';
            console.log(
                `  ${name}: ${group.correct}/${group.total} (${(group.accuracy * 100).toFixed(1)}%)${interval} — ${group.gate}`,
            );
        }
    }
    for (const [dimension, matrix] of Object.entries(
        report.confusionMatrices,
    )) {
        console.log(`\n${dimension} confusion (expected → actual)`);
        for (const [expected, actualCounts] of Object.entries(matrix)) {
            const observed = Object.entries(actualCounts)
                .map(([actual, count]) => `${actual}: ${count}`)
                .join(', ');
            console.log(`  ${expected} → ${observed}`);
        }
    }
}

// Gọi planner đúng một lần cho từng ca; giữ nguyên normalizer, strict validator và registry production.
async function main(): Promise<void> {
    const registry = loadSellerQuestionCapabilityRegistry(
        process.env.SELLER_COPILOT_CAPABILITY_REGISTRY_PATH,
    );
    validateEvaluationFixture(fixtures, registry, split);
    if (process.argv.includes('--dry-run')) {
        printFixtureCoverage(fixtures, registry, split);
        console.log(
            `Validated ${fixtures.length} ${split} cases; approved labels: ${fixtures.filter(({ reviewStatus }) => reviewStatus === 'APPROVED').length}.`,
        );
        return;
    }

    const model =
        process.env.SELLER_COPILOT_MODEL ??
        process.env.OPENAI_MODEL ??
        'gpt-4.1-mini';
    const planner = new OpenAiSellerQuestionPlannerClient({
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model,
        timeoutMs: Number(process.env.SELLER_COPILOT_TIMEOUT_MS ?? 20000),
    });
    const promptHash = hash(
        JSON.stringify(buildSellerQuestionPlannerInstructions(registry)),
    );
    const registryHash = hash(JSON.stringify(registry));
    const report = await evaluateSellerQuestionCases(
        fixtures,
        async (testCase) => {
            const context = buildSellerQuestionContext({
                question: testCase.question,
                history: testCase.history,
            });
            const result = await planner.classify({ ...context, registry });
            if (result.kind === 'failure') {
                return {
                    plan: createFailurePlan(result.reason),
                    tokenUsage: result.usage ?? null,
                };
            }
            const plan = validateSellerQuestionPlan(result.response, registry);
            if (!plan)
                return { plan: createFailurePlan('AI_INVALID_RESPONSE') };
            return { plan, tokenUsage: result.usage ?? null };
        },
        {
            split,
            model,
            promptHash,
            registryHash,
            requiredRequestTypes: registry.requestTypes.map(({ code }) => code),
            requiredDomains: registry.domains.map(({ code }) => code),
        },
    );

    printReport(report);
    const reportDirectory = resolve(
        root,
        'data/seller-question-evaluation/reports',
    );
    mkdirSync(reportDirectory, { recursive: true });
    const reportPath = join(
        reportDirectory,
        `${split}-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`,
    );
    writeFileSync(reportPath, `${JSON.stringify(report, null, 4)}\n`, 'utf8');
    console.log(`\nDiagnostic report: ${reportPath}`);
    // Chỉ holdout là gate nghiệm thu; hai tập development phải trả mã thoát thành công để dùng trong vòng chẩn đoán.
    if (split === 'holdout' && !report.passed) process.exitCode = 1;
}

// Đếm câu hỏi độc lập có chứa từng request type/domain để nhiều task trong một câu không làm tăng giả số mẫu.
function printFixtureCoverage(
    cases: SellerQuestionEvaluationCase[],
    registry: SellerQuestionCapabilityRegistry,
    selectedSplit: EvaluationSplit,
): void {
    if (selectedSplit !== 'holdout') {
        console.log(
            `${selectedSplit} set is diagnostic only; its labels do not count toward holdout acceptance.`,
        );
        return;
    }
    const approvedCases = cases.filter(
        ({ reviewStatus }) => reviewStatus === 'APPROVED',
    );
    const requestTypeCases = new Map<string, Set<string>>();
    const domainCases = new Map<string, Set<string>>();
    for (const testCase of approvedCases) {
        const requestTypesInCase = new Set<string>();
        const domainsInCase = new Set<string>();
        for (const task of testCase.expected.tasks) {
            requestTypesInCase.add(task.requestType);
            if (task.domain) {
                domainsInCase.add(task.domain);
            }
        }
        for (const requestType of requestTypesInCase) {
            let matchingCases = requestTypeCases.get(requestType);
            if (!matchingCases) {
                matchingCases = new Set<string>();
                requestTypeCases.set(requestType, matchingCases);
            }
            matchingCases.add(testCase.id);
        }
        for (const domain of domainsInCase) {
            let matchingCases = domainCases.get(domain);
            if (!matchingCases) {
                matchingCases = new Set<string>();
                domainCases.set(domain, matchingCases);
            }
            matchingCases.add(testCase.id);
        }
    }

    console.log('Approved holdout gate coverage (minimum: 100 per group):');
    for (const { code } of registry.requestTypes) {
        const total = requestTypeCases.get(code)?.size ?? 0;
        console.log(
            `  requestType ${code}: ${total} — ${total < 100 ? 'INSUFFICIENT_DATA' : 'READY_TO_EVALUATE'}`,
        );
    }
    for (const { code } of registry.domains) {
        const total = domainCases.get(code)?.size ?? 0;
        console.log(
            `  domain ${code}: ${total} — ${total < 100 ? 'INSUFFICIENT_DATA' : 'READY_TO_EVALUATE'}`,
        );
    }
}

// Dùng hash SHA-256 để so sánh lần chạy mà không phải nhúng toàn bộ prompt/config vào report.
function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

// Ghi lỗi planner thành plan kỹ thuật để evaluator không tính nhầm thành nhãn ngữ nghĩa sai.
function createFailurePlan(
    reason: SellerQuestionPlan['failureReason'],
): SellerQuestionPlan {
    return {
        status:
            reason === 'AI_INVALID_RESPONSE' ||
            reason === 'AI_REFUSAL' ||
            reason === 'AI_INCOMPLETE_RESPONSE'
                ? 'PLANNER_INVALID_RESPONSE'
                : 'PLANNER_UNAVAILABLE',
        contextRelation: 'NEW_TOPIC',
        tasks: [],
        clarificationQuestion: null,
        failureReason: reason,
    };
}

void main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : 'Unknown evaluation error.';
    console.error(message);
    process.exitCode = 1;
});
