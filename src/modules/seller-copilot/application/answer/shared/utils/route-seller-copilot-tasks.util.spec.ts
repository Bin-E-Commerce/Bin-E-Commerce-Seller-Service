import { routeSellerCopilotTasks } from '@/modules/seller-copilot/application/answer/shared/utils/route-seller-copilot-tasks.util';
import type { SellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

describe('routeSellerCopilotTasks', () => {
    // Fixture mô phỏng planner đã validate; registry quyết định nguồn thay vì nội dung câu hỏi.
    const plan: SellerQuestionPlan = {
        status: 'READY',
        contextRelation: 'NEW_TOPIC',
        tasks: [],
        clarificationQuestion: null,
        failureReason: null,
    };

    // Agent chỉ route profile/live; câu hỏi knowledge bị đánh dấu sai nguồn để caller hướng sang mode Tài liệu.
    it('keeps live reads and blocks knowledge retrieval in Agent mode', () => {
        const liveTask = {
            requestType: 'READ_QUERY' as const,
            domain: 'seller-revenue',
            resolvedQuestion: 'Doanh thu 30 ngày gần nhất là bao nhiêu?',
            shopDataIntent: 'revenue_total' as const,
        };
        const policyTask = {
            requestType: 'READ_QUERY' as const,
            domain: 'fees-settlement',
            resolvedQuestion: 'Doanh thu được ghi nhận thế nào?',
        };
        const result = routeSellerCopilotTasks({
            plan: { ...plan, tasks: [liveTask, policyTask] },
            answerTasks: [liveTask, policyTask],
            domainKinds: new Map([
                ['seller-revenue', 'live-data'],
                ['fees-settlement', 'knowledge'],
            ]),
            interactionMode: 'agent',
            originalQuestion: 'Doanh thu live và cách tính?',
        });

        expect(result.liveTasks).toEqual([liveTask]);
        expect(result.knowledgeTasks).toEqual([policyTask]);
        expect(result.wrongSourceTasks).toEqual([policyTask]);
    });
});
