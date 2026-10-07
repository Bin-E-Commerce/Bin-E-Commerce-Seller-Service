/// <reference types="jest" />

import { fetchSellerKnowledgeWithRetry } from '@/modules/seller-knowledge/infrastructure/clients/seller-knowledge-fetch.util';

// Xác nhận retry chỉ áp dụng cho lỗi kết nối và HTTP tạm thời, không lặp các lỗi 4xx.
describe('fetchSellerKnowledgeWithRetry', () => {
    let mockFetch: jest.SpyInstance;

    // Các bài test thay fetch toàn cục để không gọi dịch vụ bên ngoài.
    beforeEach(() => {
        jest.useFakeTimers();
        mockFetch = jest.spyOn(global, 'fetch');
    });

    // Khôi phục timer và fetch sau mỗi test để không làm nhiễu các suite khác.
    afterEach(() => {
        mockFetch.mockRestore();
        jest.useRealTimers();
    });

    // Lỗi mạng tạm thời được thử lại tối đa ba lần rồi trả response thành công.
    it('retries a network failure and returns the successful response', async () => {
        // Arrange
        mockFetch
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));

        // Act
        const resultPromise = fetchSellerKnowledgeWithRetry(
            'OpenAI',
            'embedding creation',
            () => fetch('https://example.test'),
        );
        await jest.advanceTimersByTimeAsync(250);
        const response = await resultPromise;

        // Assert
        expect(response.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // HTTP 503 tạm thời được retry, còn các lỗi client như 400 phải dừng ngay.
    it('retries a temporary HTTP response but does not retry a client error', async () => {
        // Arrange
        mockFetch
            .mockResolvedValueOnce(new Response('', { status: 503 }))
            .mockResolvedValueOnce(new Response('ok', { status: 200 }));

        // Act
        const resultPromise = fetchSellerKnowledgeWithRetry(
            'Qdrant',
            'point upsert',
            () => fetch('https://example.test'),
        );
        await jest.advanceTimersByTimeAsync(250);
        const response = await resultPromise;

        // Assert
        expect(response.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Một 400 tiếp theo phải được trả thẳng về caller, không có retry.
        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce(new Response('', { status: 400 }));
        const badRequest = await fetchSellerKnowledgeWithRetry(
            'Qdrant',
            'point upsert',
            () => fetch('https://example.test'),
        );
        expect(badRequest.status).toBe(400);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Khi mọi lần gọi đều lỗi mạng, thông báo giữ tên provider và thao tác để publish job chỉ đúng chỗ cần kiểm tra.
    it('reports the provider and operation after exhausting network retries', async () => {
        // Arrange
        mockFetch.mockRejectedValue(new TypeError('fetch failed'));

        // Act
        const resultPromise = fetchSellerKnowledgeWithRetry(
            'OpenAI',
            'embedding creation',
            () => fetch('https://example.test'),
        );
        const rejection = expect(resultPromise).rejects.toThrow(
            'OpenAI embedding creation network request failed after 3 attempt(s).',
        );
        await jest.runAllTimersAsync();

        // Assert
        await rejection;
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });
});
