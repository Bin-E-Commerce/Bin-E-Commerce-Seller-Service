import { ConfigService } from '@nestjs/config';
import { QdrantSellerKnowledgeIndexClient } from '@/modules/seller-knowledge/infrastructure/clients/qdrant-seller-knowledge-index.client';

// Kiểm tra adapter tự chuẩn bị collection/index và không gắn nhãn active cho point mới trước khi PostgreSQL đổi revision.
describe('QdrantSellerKnowledgeIndexClient', () => {
    let target: QdrantSellerKnowledgeIndexClient;
    let mockFetch: jest.SpyInstance;
    let collectionExists: boolean;

    // Mọi HTTP giả lập đều nằm trong test để không gọi Qdrant thật.
    beforeEach(() => {
        collectionExists = false;
        const values: Record<string, string> = {
            QDRANT_URL: 'https://qdrant.example.test',
            QDRANT_COLLECTION_SELLER_KNOWLEDGE: 'seller_knowledge_test',
            QDRANT_API_KEY: 'test-key',
        };
        const config = {
            get: (key: string, fallback?: string) => values[key] ?? fallback,
        } as unknown as ConfigService;
        target = new QdrantSellerKnowledgeIndexClient(config);
        mockFetch = jest
            .spyOn(global, 'fetch')
            .mockImplementation(async (input, init) => {
                const url = String(input);
                const method = init?.method ?? 'GET';
                if (url.endsWith('/collections/seller_knowledge_test')) {
                    if (method === 'PUT') {
                        collectionExists = true;
                        return new Response('{}', { status: 200 });
                    }
                    if (!collectionExists)
                        return new Response('{}', { status: 404 });
                    return new Response(
                        JSON.stringify({
                            result: {
                                config: { params: { vectors: { size: 2 } } },
                            },
                        }),
                        { status: 200 },
                    );
                }
                return new Response('{}', { status: 200 });
            });
    });

    // Trả lại global fetch sau test để các spec khác không bị ảnh hưởng.
    afterEach(() => {
        mockFetch.mockRestore();
    });

    // Collection vắng mặt được tạo theo embedding thực tế và point chỉ mang trạng thái indexed.
    it('creates the collection and indexes a revision without claiming it is active', async () => {
        // Arrange
        const input = {
            document: {
                id: 'document-id',
                title: 'Chính sách vận chuyển',
                slug: 'chinh-sach-van-chuyen',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: '2026-10-01',
                effectiveTo: null,
            },
            revision: { id: 'revision-id', revisionNumber: 2 },
            chunks: [{ section: 'Giao hàng', content: 'Nội dung áp dụng.' }],
            vectors: [[0.25, 0.75]],
        } as never;

        // Act
        await target.publishRevision(input);

        // Assert
        const requests = mockFetch.mock.calls as [string, RequestInit?][];
        const createRequest = requests.find(
            ([url, init]) =>
                url.endsWith('/collections/seller_knowledge_test') &&
                init?.method === 'PUT',
        );
        expect(JSON.parse(String(createRequest?.[1]?.body))).toEqual({
            vectors: { size: 2, distance: 'Cosine' },
        });
        const pointRequest = requests.find(([url]) =>
            url.includes('/points?wait=true'),
        );
        const pointsBody = JSON.parse(String(pointRequest?.[1]?.body));
        expect(pointsBody.points[0].payload).toMatchObject({
            revisionId: 'revision-id',
            status: 'indexed',
            effectiveFrom: '2026-10-01T00:00:00Z',
        });
        expect(pointsBody.points[0].payload).not.toHaveProperty('sourcePath');
        expect(pointsBody.points[0].payload.status).not.toBe('published');
        expect(
            requests.filter(([, init]) => init?.method === 'PUT'),
        ).toHaveLength(10);
    });

    // Collection đã chuẩn bị trong cùng process không cần gọi API tạo/index lại ở mỗi lần publish.
    it('reuses prepared collection metadata for subsequent revisions', async () => {
        // Arrange
        const input = {
            document: {
                id: 'document-id',
                title: 'Chính sách',
                slug: 'chinh-sach',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
            },
            revision: { id: 'revision-id', revisionNumber: 2 },
            chunks: [{ section: 'Mục', content: 'Nội dung.' }],
            vectors: [[0.25, 0.75]],
        } as never;
        await target.publishRevision(input);
        mockFetch.mockClear();

        // Act
        await target.publishRevision(input);

        // Assert
        expect(
            mockFetch.mock.calls.some(([url]) =>
                String(url).endsWith('/collections/seller_knowledge_test'),
            ),
        ).toBe(false);
        expect(
            mockFetch.mock.calls.some(([url]) =>
                String(url).endsWith(
                    '/collections/seller_knowledge_test/index',
                ),
            ),
        ).toBe(false);
    });
});
