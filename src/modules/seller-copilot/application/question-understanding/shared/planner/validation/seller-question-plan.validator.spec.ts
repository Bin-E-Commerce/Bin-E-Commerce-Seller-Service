import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.util';
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { validateSellerQuestionPlan } from '@/modules/seller-copilot/application/question-understanding/shared/planner/validation/seller-question-plan.validator';

describe('validateSellerQuestionPlan', () => {
    let registry: SellerQuestionCapabilityRegistry;

    beforeEach(() => {
        // Arrange: registry thật giúp test xác nhận allowlist domain dùng ở runtime.
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
    });

    it('should preserve ordered tasks for a valid multi-domain question', () => {
        // Arrange
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-revenue',
                    resolvedQuestion:
                        'Doanh thu shop trong tháng này là bao nhiêu?',
                },
                {
                    requestType: 'READ_QUERY',
                    domain: 'fees-settlement',
                    resolvedQuestion: 'Phí giao hàng được tính như thế nào?',
                },
            ],
            clarificationQuestion: null,
        };

        // Act
        const result = validateSellerQuestionPlan(response, registry);

        // Assert
        expect(
            result?.tasks.map(({ requestType, domain }) => ({
                requestType,
                domain,
            })),
        ).toEqual([
            { requestType: 'READ_QUERY', domain: 'seller-revenue' },
            { requestType: 'READ_QUERY', domain: 'fees-settlement' },
        ]);
    });

    it('should preserve an in-scope task when another requested part is outside scope', () => {
        // Arrange
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Shop cấu hình địa chỉ lấy hàng thế nào?',
                },
                {
                    requestType: 'OUT_OF_SCOPE',
                    domain: null,
                    resolvedQuestion: 'Dự báo thời tiết cuối tuần',
                },
            ],
            clarificationQuestion: null,
        };

        // Act
        const result = validateSellerQuestionPlan(response, registry);

        // Assert
        expect(result?.tasks.map(({ requestType }) => requestType)).toEqual([
            'READ_QUERY',
            'OUT_OF_SCOPE',
        ]);
    });

    it('should reject a policy task with a domain outside the registry', () => {
        // Arrange
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'not-registered',
                    resolvedQuestion: 'Câu hỏi chính sách',
                },
            ],
            clarificationQuestion: null,
        };

        // Act & Assert
        expect(validateSellerQuestionPlan(response, registry)).toBeNull();
    });

    // Domain có trong catalog nhưng không được phép với loại yêu cầu này vẫn phải bị từ chối.
    it('should reject a registered domain paired with an incompatible request type', () => {
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'CAPABILITY_QUERY',
                    domain: 'seller-revenue',
                    resolvedQuestion: 'Doanh thu shop là bao nhiêu?',
                },
            ],
            clarificationQuestion: null,
        };

        expect(validateSellerQuestionPlan(response, registry)).toBeNull();
    });

    it('should require a clear question for a clarification result', () => {
        // Arrange
        const response = {
            status: 'NEEDS_CLARIFICATION',
            contextRelation: 'NEW_TOPIC',
            tasks: [],
            clarificationQuestion: null,
        };

        // Act & Assert
        expect(validateSellerQuestionPlan(response, registry)).toBeNull();
    });

    it('should reject an out-of-scope result that contains a supported task', () => {
        // Arrange
        const response = {
            status: 'OUT_OF_SCOPE',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Quy trình giao nhận',
                },
            ],
            clarificationQuestion: null,
        };

        // Act & Assert
        expect(validateSellerQuestionPlan(response, registry)).toBeNull();
    });

    it('should reject fields outside the planner contract', () => {
        // Arrange
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion: 'Câu hỏi đã rõ nghĩa',
                    toolName: 'write-shop-settings',
                },
            ],
            clarificationQuestion: null,
        };

        // Act & Assert
        expect(validateSellerQuestionPlan(response, registry)).toBeNull();
    });

    // Mode dữ liệu shop cần intent enum để backend lấy đúng query/card mà không dò cụm từ tự do.
    it('should preserve a valid structured shop-data intent for its owning domain', () => {
        // Arrange
        const response = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'seller-products-inventory',
                    resolvedQuestion:
                        'Thông tin của các sản phẩm trong catalog',
                    shopDataIntent: 'product_catalog',
                },
            ],
            clarificationQuestion: null,
        };

        // Act
        const result = validateSellerQuestionPlan(
            response,
            registry,
            'shop_data',
        );

        // Assert
        expect(result?.tasks[0]?.shopDataIntent).toBe('product_catalog');
    });

    // Enum hợp lệ nhưng sai domain hoặc thiếu intent không được dùng để chọn nguồn dữ liệu.
    it('should reject a shop-data intent that is missing or belongs to another domain', () => {
        // Arrange
        const baseTask = {
            requestType: 'READ_QUERY',
            domain: 'seller-products-inventory',
            resolvedQuestion: 'Sản phẩm đang gần hết hàng',
        };
        const missingIntent = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [baseTask],
            clarificationQuestion: null,
        };
        const mismatchedIntent = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [{ ...baseTask, shopDataIntent: 'return_orders' }],
            clarificationQuestion: null,
        };
        const intentOutsideShopDataMode = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [{ ...baseTask, shopDataIntent: 'product_catalog' }],
            clarificationQuestion: null,
        };

        // Assert: cả thiếu metric lẫn metric không thuộc domain đều fail closed.
        expect(
            validateSellerQuestionPlan(missingIntent, registry, 'shop_data'),
        ).toBeNull();
        expect(
            validateSellerQuestionPlan(mismatchedIntent, registry, 'shop_data'),
        ).toBeNull();
        expect(
            validateSellerQuestionPlan(
                intentOutsideShopDataMode,
                registry,
                'chat',
            ),
        ).toBeNull();
    });
});
