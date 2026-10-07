import { ServiceUnavailableException } from '@nestjs/common';
import type { SellerKnowledgeEmbeddingPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import type { SellerKnowledgeRepositoryPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import type {
    SellerKnowledgeRerankerPort,
    SellerKnowledgeRetrievalIndexPort,
    SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';

// Retrieval service test double giữ nguồn ngoài mạng/database để kiểm tra allowlist và fallback độc lập.
describe('SellerKnowledgeRetrievalService', () => {
    let target: SellerKnowledgeRetrievalService;
    let mockRepository: jest.Mocked<
        Pick<SellerKnowledgeRepositoryPort, 'listRetrievalScopes'>
    >;
    let mockEmbedding: jest.Mocked<SellerKnowledgeEmbeddingPort>;
    let mockRetrievalIndex: jest.Mocked<SellerKnowledgeRetrievalIndexPort>;
    let mockReranker: jest.Mocked<SellerKnowledgeRerankerPort>;

    // Mỗi test nhận scope, embedding và index mới để kết quả không phụ thuộc state của ca trước.
    beforeEach(() => {
        mockRepository = {
            listRetrievalScopes: jest.fn().mockResolvedValue([
                {
                    documentId: 'doc-1',
                    revisionId: 'rev-1',
                    title: 'Chính sách giao hàng',
                    domainCode: 'shipping',
                    language: 'vi',
                    effectiveFrom: null,
                    effectiveTo: null,
                },
            ]),
        };
        mockEmbedding = {
            embed: jest.fn().mockResolvedValue([[0.2, 0.8]]),
        };
        mockRetrievalIndex = {
            search: jest.fn().mockResolvedValue([]),
        };
        mockReranker = {
            rerank: jest.fn().mockResolvedValue([]),
        };
        target = new SellerKnowledgeRetrievalService(
            mockRepository as unknown as SellerKnowledgeRepositoryPort,
            mockEmbedding,
            mockRetrievalIndex,
            mockReranker,
            {
                language: 'vi',
                candidateLimit: 50,
                contextLimit: 6,
                fallbackLimit: 3,
                maxChunksPerDocument: 2,
            },
        );
    });

    // Catalog rỗng nghĩa không có tài liệu hợp lệ; không gửi truy vấn rộng sang vector store.
    it('returns no evidence without embedding when PostgreSQL has no eligible revisions', async () => {
        // Arrange
        mockRepository.listRetrievalScopes.mockResolvedValue([]);

        // Act
        const result = await target.retrieve({
            query: 'Phí vận chuyển thế nào?',
            domainCodes: ['shipping'],
        });

        // Assert
        expect(result).toEqual([]);
        expect(mockEmbedding.embed).not.toHaveBeenCalled();
        expect(mockRetrievalIndex.search).not.toHaveBeenCalled();
        expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    // Chỉ revision hiện hành từ PostgreSQL được gửi vào Qdrant, sau đó top candidate mới tới Cohere reranker.
    it('uses the published-revision allowlist before reranking candidates', async () => {
        // Arrange
        const hit = createHit('point-1', 'doc-1', 0.8);
        mockRetrievalIndex.search.mockResolvedValue([hit]);
        mockReranker.rerank.mockResolvedValue([hit]);

        // Act
        const result = await target.retrieve({
            query: 'Phí vận chuyển thế nào?',
            domainCodes: ['shipping'],
        });

        // Assert
        expect(mockRepository.listRetrievalScopes).toHaveBeenCalledWith(
            expect.objectContaining({
                domainCodes: ['shipping'],
                language: 'vi',
            }),
        );
        expect(mockEmbedding.embed).toHaveBeenCalledWith(
            ['Phí vận chuyển thế nào?'],
            undefined,
        );
        expect(mockRetrievalIndex.search).toHaveBeenCalledWith({
            query: 'Phí vận chuyển thế nào?',
            queryVector: [0.2, 0.8],
            allowedRevisionIds: ['rev-1'],
            limit: 50,
            signal: undefined,
        });
        expect(mockReranker.rerank).toHaveBeenCalledWith({
            query: 'Phí vận chuyển thế nào?',
            hits: [hit],
            limit: 1,
            signal: undefined,
        });
        expect(result).toEqual([hit]);
    });

    // Có scope hợp lệ nhưng embedding rỗng là lỗi hạ tầng, không được báo nhầm cho người dùng rằng chưa có tài liệu.
    it('fails explicitly when the embedding provider returns an empty query vector', async () => {
        // Arrange
        mockEmbedding.embed.mockResolvedValue([[]]);

        // Act & Assert
        await expect(
            target.retrieve({
                query: 'Phí vận chuyển thế nào?',
                domainCodes: ['shipping'],
            }),
        ).rejects.toThrow(ServiceUnavailableException);
        expect(mockRetrievalIndex.search).not.toHaveBeenCalled();
        expect(mockReranker.rerank).not.toHaveBeenCalled();
    });

    // Cohere lỗi thì hybrid ranking vẫn dùng được, nhưng fallback giới hạn ba chunk và tối đa hai chunk mỗi tài liệu.
    it('keeps a bounded hybrid fallback when the reranker is unavailable', async () => {
        // Arrange
        const candidates = [
            createHit('point-1', 'doc-1', 0.9),
            createHit('point-2', 'doc-1', 0.8),
            createHit('point-3', 'doc-1', 0.7),
            createHit('point-4', 'doc-2', 0.6),
        ];
        mockRetrievalIndex.search.mockResolvedValue(candidates);
        mockReranker.rerank.mockRejectedValue(
            new Error('provider unavailable'),
        );

        // Act
        const result = await target.retrieve({
            query: 'Cách giao hàng?',
            domainCodes: [],
        });

        // Assert
        expect(result.map((hit) => hit.pointId)).toEqual([
            'point-1',
            'point-2',
            'point-4',
        ]);
    });

    // Tạo hit đầy đủ theo contract Qdrant để test không phụ thuộc payload chưa được xác thực.
    function createHit(
        pointId: string,
        documentId: string,
        score: number,
    ): SellerKnowledgeSearchHit {
        return {
            pointId,
            documentId,
            revisionId: `rev-${documentId}`,
            title: 'Chính sách giao hàng',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí',
            sectionPath: ['Phí'],
            content: 'Evidence về phí giao hàng.',
            score,
            version: '1',
        };
    }
});
