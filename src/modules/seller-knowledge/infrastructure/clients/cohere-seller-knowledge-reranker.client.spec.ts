import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerKnowledgeSearchHit } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import { CohereSellerKnowledgeRerankerClient } from '@/modules/seller-knowledge/infrastructure/clients/cohere-seller-knowledge-reranker.client';

// Kiểm tra ranh giới dữ liệu gửi Cohere và ánh xạ thứ tự rerank về đúng chunk nội bộ.
describe('CohereSellerKnowledgeRerankerClient', () => {
    let target: CohereSellerKnowledgeRerankerClient;
    let mockFetch: jest.SpyInstance;

    // Dùng API key giả và response cục bộ, không gửi query/tài liệu thật ra mạng.
    beforeEach(() => {
        const config = {
            get: (key: string, fallback?: string) =>
                key === 'COHERE_API_KEY' ? 'cohere-test-key' : fallback,
        } as unknown as ConfigService;
        target = new CohereSellerKnowledgeRerankerClient(config);
        mockFetch = jest.spyOn(global, 'fetch');
    });

    // Phục hồi fetch toàn cục sau mỗi test để adapter khác không nhận response giả.
    afterEach(() => {
        mockFetch.mockRestore();
    });

    // Kết quả rerank sắp xếp đúng hit theo index response mà không gửi các định danh riêng của hệ thống.
    it('reranks text-only candidate documents and maps relevance order', async () => {
        // Arrange
        const hits = [
            createHit('private-point-1'),
            createHit('private-point-2'),
        ];
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        { index: 1, relevance_score: 0.92 },
                        { index: 0, relevance_score: 0.31 },
                    ],
                }),
                { status: 200 },
            ),
        );

        // Act
        const result = await target.rerank({
            query: 'Phí giao hàng?',
            hits,
            limit: 2,
        });

        // Assert
        expect(result.map((hit) => hit.pointId)).toEqual([
            'private-point-2',
            'private-point-1',
        ]);
        const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
        const requestBody = JSON.parse(String(request.body));
        expect(requestBody).toMatchObject({
            model: 'rerank-v4.0-pro',
            query: 'Phí giao hàng?',
            top_n: 2,
        });
        expect(JSON.stringify(requestBody)).not.toContain('private-point');
        expect(JSON.stringify(requestBody)).not.toContain('revisionId');
    });

    // Dữ liệu provider sai không được nhân bản hit hoặc vượt quá số kết quả mà caller yêu cầu.
    it('ignores duplicate and invalid indexes and bounds the returned results', async () => {
        // Arrange
        const hits = [
            createHit('private-point-1'),
            createHit('private-point-2'),
        ];
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    results: [
                        { index: 1, relevance_score: 0.92 },
                        { index: 1, relevance_score: 0.91 },
                        { index: 8, relevance_score: 0.9 },
                        { index: 0, relevance_score: 0.8 },
                    ],
                }),
                { status: 200 },
            ),
        );

        // Act
        const result = await target.rerank({
            query: 'Phí giao hàng?',
            hits,
            limit: 1,
        });

        // Assert
        expect(result).toEqual([{ ...hits[1], score: 0.92 }]);
    });

    // HTTP thành công nhưng payload không có candidate hợp lệ phải báo lỗi để caller dùng fallback hybrid.
    it('rejects a successful response without any valid ranked result', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            new Response(JSON.stringify({ results: [] }), { status: 200 }),
        );

        // Act & Assert
        await expect(
            target.rerank({
                query: 'Phí giao hàng?',
                hits: [createHit('private-point-1')],
                limit: 1,
            }),
        ).rejects.toThrow(ServiceUnavailableException);
    });

    // Tạo hit với metadata giả để phát hiện vô tình đưa ID nội bộ vào request provider.
    function createHit(pointId: string): SellerKnowledgeSearchHit {
        return {
            pointId,
            documentId: 'private-document-id',
            revisionId: 'private-revision-id',
            title: 'Chính sách giao hàng',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
            section: 'Phí',
            sectionPath: ['Giao nhận', 'Phí'],
            content: 'Phí phụ thuộc tuyến giao nhận của shop.',
            score: 0.4,
            version: '1',
        };
    }
});
