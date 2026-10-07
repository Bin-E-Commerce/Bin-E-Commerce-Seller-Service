import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiSellerKnowledgeEmbeddingClient } from '@/modules/seller-knowledge/infrastructure/clients/openai-seller-knowledge-embedding.client';

// Kiểm tra batch embedding được ghép đúng index và từ chối vector không bảo toàn được ánh xạ chunk.
describe('OpenAiSellerKnowledgeEmbeddingClient', () => {
    let target: OpenAiSellerKnowledgeEmbeddingClient;
    let mockFetch: jest.SpyInstance;

    // Dùng API key giả, dimension nhỏ và response cục bộ để không phát sinh request/token thật.
    beforeEach(() => {
        const config = {
            get: (key: string, fallback?: string) => {
                if (key === 'OPENAI_API_KEY') return 'openai-test-key';
                if (key === 'SELLER_KNOWLEDGE_EMBEDDING_DIMENSIONS') return '2';
                return fallback;
            },
        } as unknown as ConfigService;
        target = new OpenAiSellerKnowledgeEmbeddingClient(config);
        mockFetch = jest.spyOn(global, 'fetch');
    });

    // Khôi phục fetch toàn cục để mock không rò sang test khác.
    afterEach(() => {
        mockFetch.mockRestore();
    });

    // Provider có thể trả batch khác thứ tự; client phải trả vectors theo vị trí inputs ban đầu.
    it('returns embeddings in the original input order', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        { index: 1, embedding: [0.3, 0.4] },
                        { index: 0, embedding: [0.1, 0.2] },
                    ],
                }),
                { status: 200 },
            ),
        );

        // Act
        const result = await target.embed(['chunk A', 'chunk B']);

        // Assert
        expect(result).toEqual([
            [0.1, 0.2],
            [0.3, 0.4],
        ]);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Duplicate index dù response có đủ số dòng vẫn làm thiếu vector cho một chunk, nên phải fail closed.
    it('rejects duplicate provider indexes instead of pairing a vector with the wrong chunk', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        { index: 0, embedding: [0.1, 0.2] },
                        { index: 0, embedding: [0.3, 0.4] },
                    ],
                }),
                { status: 200 },
            ),
        );

        // Act & Assert
        await expect(target.embed(['chunk A', 'chunk B'])).rejects.toThrow(
            ServiceUnavailableException,
        );
    });

    // Vector phải khớp dimension đã gửi và chỉ chứa số hữu hạn trước khi caller ghi xuống Qdrant.
    it('rejects wrong-sized and non-finite vectors', async () => {
        // Arrange
        mockFetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [{ index: 0, embedding: [Number.NaN, 0.2, 0.3] }],
                }),
                { status: 200 },
            ),
        );

        // Act & Assert
        await expect(target.embed(['chunk A'])).rejects.toThrow(
            ServiceUnavailableException,
        );
    });
});
