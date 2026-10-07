// Adapter gọi Cohere Rerank để sắp lại ứng viên hybrid; chỉ gửi câu hỏi và nội dung cần so khớp.
// Không gửi shop/user ID, point ID, revision ID hay metadata vận hành ra nhà cung cấp.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
    SellerKnowledgeRerankerPort,
    SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

@Injectable()
// Adapter chỉ xếp hạng lại candidate, không tạo evidence mới hoặc lưu metadata tenant tại provider.
export class CohereSellerKnowledgeRerankerClient implements SellerKnowledgeRerankerPort {
    // Đọc credential từ cấu hình server để API key không đi qua request của FE.
    constructor(private readonly config: ConfigService) {}

    // Gửi văn bản ứng viên tới rerank-v4.0-pro; kết quả chỉ đổi thứ tự/điểm, không làm biến đổi evidence gốc.
    // ID nội bộ chỉ dùng để ánh xạ index response về hit ban đầu; lỗi cấu hình/mạng được caller xử lý bằng fallback RRF giới hạn.
    async rerank(input: {
        query: string;
        hits: SellerKnowledgeSearchHit[];
        limit: number;
        signal?: AbortSignal;
    }): Promise<SellerKnowledgeSearchHit[]> {
        const apiKey = this.config.get<string>('COHERE_API_KEY', '');
        if (!apiKey)
            throw new ServiceUnavailableException(
                'Chưa cấu hình Cohere reranker.',
            );
        if (!input.hits.length) return [];

        // Chỉ chuyển title, heading và body; ID nội bộ không cần cho model và được ánh xạ lại bằng index response.
        const documents = input.hits.map(
            (hit) =>
                `Tiêu đề: ${hit.title}\nMục: ${hit.sectionPath.join(' > ')}\nNội dung:\n${hit.content}`,
        );
        const requestedLimit = Number.isFinite(input.limit)
            ? Math.max(1, Math.min(Math.floor(input.limit), input.hits.length))
            : input.hits.length;
        // Chặn cấu hình token không hợp lệ để request rerank luôn nằm trong giới hạn có thể kiểm soát.
        const configuredMaxTokens = Number(
            this.config.get<string>(
                'SELLER_KNOWLEDGE_RERANK_MAX_TOKENS_PER_DOC',
                '2048',
            ),
        );
        const maxTokensPerDoc = Number.isFinite(configuredMaxTokens)
            ? Math.max(1, Math.min(Math.floor(configuredMaxTokens), 4096))
            : 2048;
        const response = await fetch('https://api.cohere.com/v2/rerank', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: this.config.get<string>(
                    'SELLER_KNOWLEDGE_RERANKER_MODEL',
                    'rerank-v4.0-pro',
                ),
                query: input.query,
                documents,
                top_n: requestedLimit,
                max_tokens_per_doc: maxTokensPerDoc,
            }),
            signal: input.signal
                ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
                : AbortSignal.timeout(15_000),
        });
        if (!response.ok)
            throw new ServiceUnavailableException(
                `Cohere reranker failed (${response.status}).`,
            );

        const body = (await response.json()) as {
            results?: { index: number; relevance_score: number }[];
        };
        // Bỏ index sai/trùng và điểm ngoài miền; mỗi hit chỉ được trả tối đa một lần, theo thứ tự Cohere xếp hạng.
        const seenIndexes = new Set<number>();
        const rankedHits = (body.results ?? [])
            .flatMap((result) => {
                const hit = input.hits[result.index];
                if (
                    !Number.isInteger(result.index) ||
                    !hit ||
                    seenIndexes.has(result.index) ||
                    !Number.isFinite(result.relevance_score) ||
                    result.relevance_score < 0 ||
                    result.relevance_score > 1
                ) {
                    return [];
                }
                seenIndexes.add(result.index);
                return [{ ...hit, score: result.relevance_score }];
            })
            .slice(0, requestedLimit);
        // HTTP 200 nhưng không có kết quả hợp lệ là response lỗi; caller cần fallback RRF thay vì báo không có tài liệu.
        if (!rankedHits.length)
            throw new ServiceUnavailableException(
                'Cohere reranker không trả về kết quả hợp lệ.',
            );
        return rankedHits;
    }
}
