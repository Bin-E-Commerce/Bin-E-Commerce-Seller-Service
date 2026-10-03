// Kiểm tra hợp đồng request planner: nội dung hướng dẫn, ngữ cảnh gửi đi và schema giới hạn phản hồi của model.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.util';
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import { OpenAiSellerQuestionPlannerClient } from '@/modules/seller-copilot/infrastructure/clients/openai-seller-question-planner.client';

describe('OpenAiSellerQuestionPlannerClient', () => {
    let registry: SellerQuestionCapabilityRegistry;

    beforeEach(() => {
        // Arrange: registry dùng allowlist request type/domain mà model được phép chọn.
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

    it('should return not-configured without making an HTTP request', async () => {
        // Arrange
        const mockFetch = jest.fn();
        const target = new OpenAiSellerQuestionPlannerClient(
            { apiKey: '', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            mockFetch,
        );

        // Act
        const result = await target.classify({
            question: 'Bạn ơi',
            history: [],
            registry,
        });

        // Assert
        expect(result).toEqual({
            kind: 'failure',
            reason: 'AI_NOT_CONFIGURED',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    // Bảo đảm model nhận được định nghĩa ngữ nghĩa chứ không chỉ các tên enum, đồng thời chỉ được trả cấu trúc backend hỗ trợ.
    it('should send semantic instructions and a constrained schema with the planner request', async () => {
        // Arrange
        const plan = {
            status: 'READY',
            contextRelation: 'NEW_TOPIC',
            tasks: [
                {
                    requestType: 'READ_QUERY',
                    domain: 'shipping',
                    resolvedQuestion:
                        'Cấu hình giao nhận hiện tại được mô tả thế nào?',
                },
            ],
            clarificationQuestion: null,
        };
        const mockFetch = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: JSON.stringify(plan) } }],
                    usage: {
                        prompt_tokens: 120,
                        completion_tokens: 30,
                        total_tokens: 150,
                    },
                }),
                { status: 200 },
            ),
        );
        const target = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            mockFetch,
        );

        // Act
        const result = await target.classify({
            question: 'Giao nhận của shop hoạt động ra sao?',
            history: [],
            registry,
        });

        // Assert
        expect(result).toEqual({
            kind: 'success',
            response: plan,
            usage: {
                promptTokens: 120,
                completionTokens: 30,
                totalTokens: 150,
            },
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
        const requestBody = JSON.parse(String(request.body)) as {
            response_format: {
                json_schema: { strict: boolean; schema: unknown };
            };
            messages: Array<{ role: string; content: string }>;
        };
        expect(requestBody.response_format.json_schema.strict).toBe(true);
        expect(requestBody.messages).toHaveLength(2);
        expect(requestBody.messages[0]?.content).toContain(
            'requestType mô tả người dùng muốn làm gì',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'CLARIFICATION_REPLY là câu trả lời cho câu hỏi làm rõ gần nhất',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Không dùng NEEDS_CLARIFICATION như lựa chọn mặc định',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '“Bạn ơi” → READY, một task SMALL_TALK domain null',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'seller-products-inventory: danh sách/thông tin sản phẩm, tồn kho và sản phẩm bán chạy/top sản phẩm',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'nếu động từ thao tác và đối tượng đã rõ thì tạo task READY dù còn thiếu giá trị mới',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '“Xác nhận tất cả đơn đang chờ giúp tôi” là CHANGE_REQUEST/seller-orders',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '“Hệ thống hiện lưu những thông tin nào về đối soát?” → fees-settlement',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '“đơn báo đã thu tiền, vậy tiền đã chuyển về shop chưa?” thì chọn fees-settlement',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Câu trả lời assistant chỉ giúp hiểu chủ đề, không phải bằng chứng để lặp lại số liệu cũ.',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '"currentQuestion":"Còn số đơn thì sao?"',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Trong 30 ngày gần nhất shop có bao nhiêu đơn hàng?',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Áo thun màu đen size M hiện còn bao nhiêu sản phẩm?',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '“Tôi muốn tìm phần cấu hình shop” đã đủ để route tới seller-center-troubleshooting',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '"code":"CAPABILITY_QUERY"',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '"code":"seller-copilot-capabilities"',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'mô hình kinh doanh',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Ví dụ 5 — trả lời làm rõ',
        );
        expect(requestBody.messages[0]?.content).toContain(
            'Ví dụ 6 — chưa đủ ngữ cảnh',
        );
        expect(requestBody.messages[0]?.content).not.toContain(
            'Nếu chưa chắc nhưng có thể hỏi lại',
        );
        expect(requestBody.messages[0]?.content).toContain(
            '"contextRelation":"CLARIFICATION_REPLY"',
        );
        expect(JSON.parse(requestBody.messages[1]?.content ?? '')).toEqual({
            recentConversation: [],
            currentQuestion: 'Giao nhận của shop hoạt động ra sao?',
        });
        expect(requestBody.response_format.json_schema.schema).toMatchObject({
            additionalProperties: false,
            required: [
                'status',
                'contextRelation',
                'tasks',
                'clarificationQuestion',
            ],
            properties: {
                status: {
                    enum: ['READY', 'NEEDS_CLARIFICATION', 'OUT_OF_SCOPE'],
                },
                contextRelation: {
                    enum: ['NEW_TOPIC', 'FOLLOW_UP', 'CLARIFICATION_REPLY'],
                },
                tasks: {
                    items: {
                        required: ['requestType', 'domain', 'resolvedQuestion'],
                    },
                },
            },
        });
    });

    it('should distinguish HTTP provider errors from invalid structured content', async () => {
        // Arrange
        const providerErrorFetch = jest
            .fn()
            .mockResolvedValue(new Response('', { status: 503 }));
        const invalidResponseFetch = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: '{bad' } }],
                }),
                { status: 200 },
            ),
        );
        const providerClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            providerErrorFetch,
        );
        const invalidResponseClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            invalidResponseFetch,
        );

        // Act
        const providerResult = await providerClient.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });
        const invalidResult = await invalidResponseClient.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });

        // Assert
        expect(providerResult).toEqual({
            kind: 'failure',
            reason: 'AI_PROVIDER_ERROR',
        });
        expect(invalidResult).toEqual({
            kind: 'failure',
            reason: 'AI_INVALID_RESPONSE',
        });
    });

    it('should classify network and malformed transport responses separately', async () => {
        // Arrange
        const networkFetch = jest
            .fn()
            .mockRejectedValue(new Error('network unavailable'));
        const malformedTransportFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockRejectedValue(new Error('invalid envelope')),
        });
        const networkClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            networkFetch,
        );
        const malformedTransportClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            malformedTransportFetch,
        );

        // Act
        const networkResult = await networkClient.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });
        const malformedTransportResult =
            await malformedTransportClient.classify({
                question: 'Câu hỏi',
                history: [],
                registry,
            });

        // Assert
        expect(networkResult).toEqual({
            kind: 'failure',
            reason: 'AI_PROVIDER_ERROR',
        });
        expect(malformedTransportResult).toEqual({
            kind: 'failure',
            reason: 'AI_INVALID_RESPONSE',
        });
    });

    it('should reject a successful HTTP response that has no completion content', async () => {
        // Arrange
        const mockFetch = jest
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ choices: [] }), { status: 200 }),
            );
        const target = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            mockFetch,
        );

        // Act
        const result = await target.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });

        // Assert
        expect(result).toEqual({
            kind: 'failure',
            reason: 'AI_INVALID_RESPONSE',
        });
    });

    // Từ chối và output bị cắt là hai lỗi kỹ thuật riêng; evaluator không được chấm chúng như nhầm ý định.
    it('should distinguish model refusal from an incomplete completion', async () => {
        const refusalFetch = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                refusal: 'Request refused',
                                content: null,
                            },
                            finish_reason: 'stop',
                        },
                    ],
                    usage: {
                        prompt_tokens: 80,
                        completion_tokens: 12,
                        total_tokens: 92,
                    },
                }),
                { status: 200 },
            ),
        );
        const incompleteFetch = jest.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: { content: '{"status":' },
                            finish_reason: 'length',
                        },
                    ],
                }),
                { status: 200 },
            ),
        );
        const refusalClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            refusalFetch,
        );
        const incompleteClient = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            incompleteFetch,
        );

        const refusal = await refusalClient.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });
        const incomplete = await incompleteClient.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
        });

        expect(refusal).toEqual({
            kind: 'failure',
            reason: 'AI_REFUSAL',
            usage: {
                promptTokens: 80,
                completionTokens: 12,
                totalTokens: 92,
            },
        });
        expect(incomplete).toEqual({
            kind: 'failure',
            reason: 'AI_INCOMPLETE_RESPONSE',
        });
    });

    // Hủy do người dùng dừng chat phải truyền tới fetch và thoát dạng cancellation, không bị đổi thành provider error.
    it('should propagate caller cancellation to the provider request', async () => {
        // Arrange
        const abortController = new AbortController();
        const mockFetch = jest.fn(
            (_url: string | URL | Request, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener(
                        'abort',
                        () => reject(new Error('request aborted')),
                        { once: true },
                    );
                }),
        );
        const target = new OpenAiSellerQuestionPlannerClient(
            { apiKey: 'test-key', model: 'gpt-4.1-mini', timeoutMs: 1000 },
            mockFetch,
        );
        const request = target.classify({
            question: 'Câu hỏi',
            history: [],
            registry,
            signal: abortController.signal,
        });

        // Act
        abortController.abort();

        // Assert
        await expect(request).rejects.toThrow('request aborted');
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, fetchOptions] = mockFetch.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(fetchOptions.signal?.aborted).toBe(true);
    });
});
