import { ConfigService } from '@nestjs/config';
import type { SellerKnowledgeSearchHit } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import { OpenAiSellerCopilotAnswerClient } from '@/modules/seller-copilot/infrastructure/clients/openai-seller-copilot-answer.client';

// Kiểm tra JSON answer được giải mã tăng dần, giữ Markdown và không lộ citation số hay nội dung thiếu căn cứ.
describe('OpenAiSellerCopilotAnswerClient', () => {
    let target: OpenAiSellerCopilotAnswerClient;
    let mockFetch: jest.SpyInstance;

    // Dùng key/model giả để test không gửi nội dung hội thoại ra ngoài hoặc tiêu thụ token.
    beforeEach(() => {
        const config = {
            get: (key: string, fallback?: string) =>
                key === 'OPENAI_API_KEY' ? 'openai-test-key' : fallback,
        } as unknown as ConfigService;
        target = new OpenAiSellerCopilotAnswerClient(config);
        mockFetch = jest.spyOn(global, 'fetch');
    });

    // Trả lại fetch thật sau mỗi ca để mock không rò rỉ sang test khác.
    afterEach(() => {
        mockFetch.mockRestore();
    });

    // Mỗi delta của chuỗi Markdown được chuyển ngay, không cần chờ chuỗi JSON answer đóng.
    it('streams formatted Markdown before the JSON answer is complete', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"## Phí',
                ' vận chuyển\\n\\nPhí **phụ thuộc theo',
                ' khu vực** [1]',
                '","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        // Act
        const parts = await collect(
            target.stream({
                question: 'Phí bán hàng của shop được tính như thế nào?',
                evidence: [createHit()],
            }),
        );

        // Assert
        expect(parts).toEqual([
            { type: 'delta', text: '## Phí' },
            { type: 'delta', text: ' vận chuyển\n\nPhí **phụ thuộc theo' },
            { type: 'delta', text: ' khu vực**' },
            {
                type: 'complete',
                answer: '## Phí vận chuyển\n\nPhí **phụ thuộc theo khu vực**',
                supported: true,
                visualizations: [],
                sourcesUsed: [],
            },
        ]);
        const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
        const requestBody = JSON.parse(String(request.body)) as {
            stream: boolean;
            response_format: {
                type: string;
                json_schema: {
                    strict: boolean;
                    schema: {
                        required: string[];
                        properties: {
                            answer: { type: string; maxLength: number };
                        };
                    };
                };
            };
        };
        expect(requestBody).toMatchObject({
            stream: true,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    strict: true,
                    schema: {
                        required: [
                            'supported',
                            'answer',
                            'visualizations',
                            'sourcesUsed',
                        ],
                    },
                },
            },
        });
        expect(
            requestBody.response_format.json_schema.schema.properties.answer,
        ).toEqual({ type: 'string', maxLength: 8000 });
    });

    // Prompt giữ format linh hoạt theo cấu trúc nội dung dù provider chỉ cần stream một trường Markdown.
    it('asks the model to choose Markdown structure by answer complexity, not keywords', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Có thể nhé.","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        // Act
        await collect(
            target.stream({
                question: 'Chính sách chung về sản phẩm là gì?',
                evidence: [createHit()],
                interactionMode: 'knowledge',
            }),
        );

        // Assert
        const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(request.body)) as {
            messages: Array<{ role: string; content: string }>;
        };
        const prompt = body.messages.find(
            (message) => message.role === 'system',
        )?.content;
        expect(prompt).toContain('không theo từ khóa');
        expect(prompt).toContain('Trường answer là Markdown');
        expect(prompt).toContain('quy trình mới dùng danh sách đánh số');
        expect(prompt).toContain('tuyệt đối không lặp số 1 cho từng mục');
        expect(prompt).toContain('Chỉ dùng bảng khi cần so sánh cùng tiêu chí');
        expect(prompt).toContain('ép câu trả lời ngắn thành nhiều mục');
        expect(prompt).toContain('Mode Tài liệu');
    });

    // Semantic visual intent đi theo nghĩa câu hỏi; model chỉ chọn enum, dữ liệu biểu đồ vẫn do backend dựng.
    it('returns an allowlisted revenue visual intent for a shop-data answer', async () => {
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Doanh thu đang tăng.","visualizations":["revenue_trend"],"sourcesUsed":["live_data"]}',
            ]),
        );

        const parts = await collect(
            target.stream({
                question: 'Doanh thu shop biến động thế nào gần đây?',
                evidence: [],
                interactionMode: 'shop_data',
                contextData: JSON.stringify({
                    liveData: { revenueTrend: [{ date: '2026-10-01' }] },
                }),
            }),
        );

        expect(parts.at(-1)).toEqual({
            type: 'complete',
            answer: 'Doanh thu đang tăng.',
            supported: true,
            visualizations: ['revenue_trend'],
            sourcesUsed: ['live_data'],
        });
        const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(String(request.body)) as {
            messages: Array<{ role: string; content: string }>;
        };
        const prompt = body.messages.find(
            (message) => message.role === 'system',
        )?.content;
        expect(prompt).toContain('Không ghép visual chỉ vì cùng domain');
        expect(prompt).toContain(
            'Backend chỉ dựng visual từ intent/domain và snapshot xác thực',
        );
    });

    // Yêu cầu đếm/list đơn hoàn thành phải có intent riêng để backend lọc trạng thái, không dùng danh sách đơn mới nhất lẫn trạng thái.
    it('accepts the completed-orders visual intent for a shop-data answer', async () => {
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Có 4 đơn hoàn thành.","visualizations":["completed_orders"],"sourcesUsed":["live_data"]}',
            ]),
        );

        const parts = await collect(
            target.stream({
                question: 'Có bao nhiêu đơn đã hoàn thành?',
                evidence: [],
                interactionMode: 'shop_data',
                contextData: JSON.stringify({
                    liveData: { orderStatusCounts: { completed: 4 } },
                }),
            }),
        );

        expect(parts.at(-1)).toEqual({
            type: 'complete',
            answer: 'Có 4 đơn hoàn thành.',
            supported: true,
            visualizations: ['completed_orders'],
            sourcesUsed: ['live_data'],
        });
    });

    // Enum mới được adapter chấp nhận nhưng backend vẫn tự giới hạn kết quả theo intent/catalog.
    it('accepts sold-products and exact out-of-stock visual intents', async () => {
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Đã tìm thấy sản phẩm.","visualizations":["sold_products","out_of_stock"],"sourcesUsed":["live_data"]}',
            ]),
        );

        const parts = await collect(
            target.stream({
                question: 'Sản phẩm nào đã bán và sản phẩm nào hết hàng?',
                evidence: [],
                interactionMode: 'shop_data',
                contextData: JSON.stringify({
                    liveData: { topProducts: [] },
                    productCatalog: { items: [] },
                }),
            }),
        );

        expect(parts.at(-1)).toEqual({
            type: 'complete',
            answer: 'Đã tìm thấy sản phẩm.',
            supported: true,
            visualizations: ['sold_products', 'out_of_stock'],
            sourcesUsed: ['live_data'],
        });
    });

    // supported=false phải chặn toàn bộ trường answer, kể cả khi nó đã có trong JSON cuối cùng.
    it('does not expose model text when evidence is insufficient', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":false,"answer":"Nội dung model tự suy đoán.","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        // Act
        const parts = await collect(
            target.stream({
                question: 'Có miễn phí mọi đơn không?',
                evidence: [createHit()],
            }),
        );

        // Assert
        expect(parts).toEqual([
            {
                type: 'complete',
                answer: 'Hiện tại mình chưa tìm thấy tài liệu phù hợp để trả lời câu hỏi này. Bạn có thể liên hệ quản trị viên của shop để được hỗ trợ thêm nhé 🙂.',
                supported: false,
                visualizations: [],
                sourcesUsed: [],
            },
        ]);
    });

    // Chat không có evidence nghiệp vụ; supported=false không được biến kiến thức phổ thông thành thông báo thiếu tài liệu.
    it('keeps a natural chat response when the grounding flag is false', async () => {
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":false,"answer":"Chim màu xanh thường là chim vẹt; màu lông tùy loài nhé.","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        const parts = await collect(
            target.stream({
                question: 'Bạn biết con chim màu gì không?',
                evidence: [],
                interactionMode: 'chat',
            }),
        );

        expect(parts.at(-1)).toEqual({
            type: 'complete',
            answer: 'Chim màu xanh thường là chim vẹt; màu lông tùy loài nhé.',
            supported: false,
            visualizations: [],
            sourcesUsed: [],
        });
        expect(
            parts.some(
                (part) =>
                    part.type === 'complete' &&
                    part.answer.includes('tài liệu'),
            ),
        ).toBe(false);
    });

    // Ca tái hiện lỗi production: model quên citation nhưng nội dung vẫn hoàn tất để nguồn hiển thị riêng từ metadata.
    it('completes an evidence-based answer when the model omits numeric citations', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Phí phụ thuộc vào báo giá vận chuyển.","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        // Act
        const parts = await collect(
            target.stream({
                question: 'Phí được tính thế nào?',
                evidence: [createHit()],
            }),
        );

        // Assert
        expect(parts).toEqual([
            {
                type: 'delta',
                text: 'Phí phụ thuộc vào báo giá vận chuyển.',
            },
            {
                type: 'complete',
                answer: 'Phí phụ thuộc vào báo giá vận chuyển.',
                supported: true,
                visualizations: [],
                sourcesUsed: [],
            },
        ]);
    });

    // Citation bị chia qua nhiều delta vẫn bị loại sạch nhưng dấu cách giữa câu được giữ đúng.
    it('filters numeric citation markers split across provider deltas', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            streamResponse([
                '{"supported":true,"answer":"Được miễn phí [1',
                '] cho đơn',
                ' này.","visualizations":[],"sourcesUsed":[]}',
            ]),
        );

        // Act
        const parts = await collect(
            target.stream({
                question: 'Đơn nào được miễn phí?',
                evidence: [createHit()],
            }),
        );

        // Assert
        expect(parts).toEqual([
            { type: 'delta', text: 'Được miễn phí' },
            { type: 'delta', text: ' cho đơn' },
            { type: 'delta', text: ' này.' },
            {
                type: 'complete',
                answer: 'Được miễn phí cho đơn này.',
                supported: true,
                visualizations: [],
                sourcesUsed: [],
            },
        ]);
    });

    // Escape Markdown/newline bị tách giữa packet vẫn được giải mã đúng và final khớp toàn bộ delta đã stream.
    it('decodes JSON escapes split across provider deltas', async () => {
        // Arrange
        const serialized = JSON.stringify({
            supported: true,
            answer: '## Kết luận\n\nPhí phụ thuộc **khu vực** [1].',
            visualizations: [],
            sourcesUsed: [],
        });
        const escapedNewline = serialized.indexOf('\\n');
        mockFetch.mockResolvedValue(
            streamResponse([
                serialized.slice(0, escapedNewline + 1),
                serialized.slice(escapedNewline + 1),
            ]),
        );

        // Act
        const parts = await collect(
            target.stream({
                question: 'Phí tính thế nào?',
                evidence: [createHit()],
            }),
        );

        // Assert
        const streamedText = parts
            .filter((part) => part.type === 'delta')
            .map((part) => part.text)
            .join('');
        expect(streamedText).toBe('## Kết luận\n\nPhí phụ thuộc **khu vực**.');
        expect(parts.at(-1)).toEqual({
            type: 'complete',
            answer: streamedText,
            supported: true,
            visualizations: [],
            sourcesUsed: [],
        });
    });

    // Tạo evidence cố định để mọi citation hợp lệ phải thuộc nguồn đã gửi cho model.
    function createHit(): SellerKnowledgeSearchHit {
        return {
            pointId: 'point-1',
            documentId: 'document-1',
            revisionId: 'revision-1',
            title: 'Chính sách giao hàng',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí',
            sectionPath: ['Giao nhận', 'Phí'],
            content: 'Mức phí phụ thuộc tuyến giao nhận.',
            score: 0.9,
            version: '1',
        };
    }

    // Tạo response SSE của Chat Completions với delta được chia ngẫu nhiên theo ranh giới JSON.
    function streamResponse(contentDeltas: string[]): Response {
        const events = contentDeltas.map(
            (content) =>
                `data: ${JSON.stringify({
                    choices: [{ delta: { content } }],
                })}\n\n`,
        );
        events.push('data: [DONE]\n\n');
        return new Response(events.join(''), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        });
    }

    // Thu generator để khẳng định thứ tự block delta và final content.
    async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
        const values: T[] = [];
        for await (const value of stream) values.push(value);
        return values;
    }
});
