import { ConfigService } from '@nestjs/config';
import { QdrantSellerKnowledgeIndexClient } from '@/modules/seller-knowledge/infrastructure/clients/qdrant-seller-knowledge-index.client';

// Kiểm tra adapter tự chuẩn bị collection/index và không gắn nhãn active cho point mới trước khi PostgreSQL đổi revision.
describe('QdrantSellerKnowledgeIndexClient', () => {
    let target: QdrantSellerKnowledgeIndexClient;
    let mockFetch: jest.SpyInstance;
    let collectionExists: boolean;
    let pointVisible: boolean;

    // Mọi HTTP giả lập đều nằm trong test để không gọi Qdrant thật.
    beforeEach(() => {
        collectionExists = false;
        pointVisible = true;
        const values: Record<string, string> = {
            QDRANT_URL: 'https://qdrant.example.test',
            QDRANT_COLLECTION_SELLER_KNOWLEDGE_V2: 'seller_knowledge_test',
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
                                config: {
                                    params: { vectors: { dense: { size: 2 } } },
                                },
                            },
                        }),
                        { status: 200 },
                    );
                }
                if (
                    url.includes('/points/') &&
                    !url.endsWith('/points/query')
                ) {
                    return new Response(
                        JSON.stringify({
                            result: pointVisible
                                ? { id: url.split('/').at(-1) }
                                : null,
                        }),
                        { status: 200 },
                    );
                }
                if (url.endsWith('/points/query')) {
                    return new Response(
                        JSON.stringify({ result: { points: [] } }),
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
            chunks: [
                {
                    section: 'Giao hàng',
                    sectionPath: ['Giao hàng'],
                    content: 'Nội dung áp dụng.',
                    chunkIndex: 1,
                },
            ],
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
            vectors: { dense: { size: 2, distance: 'Cosine' } },
            sparse_vectors: { sparse: { modifier: 'idf' } },
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
        expect(pointsBody.points[0].vector.sparse).toMatchObject({
            model: 'qdrant/bm25',
            options: {
                tokenizer: 'multilingual',
                stemmer: { type: 'none' },
                stopwords: {},
            },
        });
        expect(pointsBody.points[0].payload.status).not.toBe('published');
        expect(
            requests.filter(([, init]) => init?.method === 'PUT'),
        ).toHaveLength(3);
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
            chunks: [
                {
                    section: 'Mục',
                    sectionPath: ['Mục'],
                    content: 'Nội dung.',
                    chunkIndex: 1,
                },
            ],
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

    // Không cho phép gửi batch lệch số chunk/vector vì khi đó vector có thể bị gắn nhầm nội dung.
    it('rejects a mismatched chunk and vector count before writing to Qdrant', async () => {
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
            revision: { id: 'revision-id', revisionNumber: 1 },
            chunks: [
                {
                    section: 'Mục',
                    sectionPath: ['Mục'],
                    content: 'Nội dung.',
                    chunkIndex: 1,
                },
            ],
            vectors: [],
        } as never;

        // Act & Assert
        await expect(target.publishRevision(input)).rejects.toThrow(
            'Số đoạn nội dung và vector embedding không khớp.',
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });

    // Qdrant trả 200 nhưng chưa đọc lại được point thì không được báo publish index thành công.
    it('rejects an upsert that cannot be read back even when Qdrant returns HTTP 200', async () => {
        // Arrange
        pointVisible = false;
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
            revision: { id: 'revision-id', revisionNumber: 1 },
            chunks: [
                {
                    section: 'Mục',
                    sectionPath: ['Mục'],
                    content: 'Nội dung.',
                    chunkIndex: 1,
                },
            ],
            vectors: [[0.25, 0.75]],
        } as never;

        // Act & Assert
        await expect(target.publishRevision(input)).rejects.toThrow(
            'Qdrant chưa thể đọc lại vector vừa lập chỉ mục.',
        );
    });

    // Hybrid retrieval phải lọc dense và sparse bằng allowlist PG và dùng đúng BM25 multilingual không-English stemming.
    it('searches only allowed revisions with dense and language-neutral BM25 legs', async () => {
        // Arrange
        const input = {
            query: 'Quy trình giao hàng',
            queryVector: [0.25, 0.75],
            allowedRevisionIds: ['revision-live'],
            limit: 50,
        };

        // Act
        await target.search(input);

        // Assert
        const requests = mockFetch.mock.calls as [string, RequestInit?][];
        const queryRequest = requests.find(
            ([url, init]) =>
                url.endsWith('/points/query') && init?.method === 'POST',
        );
        expect(queryRequest).toBeDefined();
        const queryBody = JSON.parse(String(queryRequest?.[1]?.body));
        expect(queryBody.prefetch).toHaveLength(2);
        expect(queryBody.prefetch[0]).toMatchObject({
            query: input.queryVector,
            using: 'dense',
            filter: {
                must: [
                    {
                        key: 'revisionId',
                        match: { any: ['revision-live'] },
                    },
                ],
            },
        });
        expect(queryBody.prefetch[1]).toMatchObject({
            using: 'sparse',
            query: {
                text: input.query,
                model: 'qdrant/bm25',
                options: {
                    tokenizer: 'multilingual',
                    stemmer: { type: 'none' },
                    stopwords: {},
                },
            },
        });
        expect(queryBody.query).toEqual({ rrf: {} });
        expect(queryBody.limit).toBe(50);
    });

    // Vector không hữu hạn không được gửi đi vì Qdrant sẽ từ chối hoặc cho kết quả xếp hạng không xác định.
    it('rejects a malformed query vector before making a Qdrant request', async () => {
        // Arrange
        const input = {
            query: 'Cách giao hàng?',
            queryVector: [Number.NaN],
            allowedRevisionIds: ['revision-live'],
            limit: 10,
        };

        // Act & Assert
        await expect(target.search(input)).rejects.toThrow(
            'Vector truy vấn không hợp lệ.',
        );
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
