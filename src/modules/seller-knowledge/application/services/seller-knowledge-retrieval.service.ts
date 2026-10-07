// Điều phối tìm kiếm hybrid và xếp hạng lại trên đúng các revision PostgreSQL cho phép truy xuất.
// Service không tự truy vấn DB hay gọi API nhà cung cấp; các ranh giới đó thuộc repository và adapter hạ tầng.
import {
    Inject,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    SELLER_KNOWLEDGE_EMBEDDING,
    type SellerKnowledgeEmbeddingPort,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import {
    SELLER_KNOWLEDGE_REPOSITORY,
    type SellerKnowledgeRepositoryPort,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import {
    SELLER_KNOWLEDGE_RERANKER,
    SELLER_KNOWLEDGE_RETRIEVAL_INDEX,
    SELLER_KNOWLEDGE_RETRIEVAL_CONFIG,
    type SellerKnowledgeRetrievalConfig,
    type SellerKnowledgeRetrievalIndexPort,
    type SellerKnowledgeRerankerPort,
    type SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

@Injectable()
// Use case retrieval giữ pipeline cố định: scope DB trước, hybrid search sau, rerank cuối và fallback có giới hạn.
export class SellerKnowledgeRetrievalService {
    private readonly logger = new Logger(SellerKnowledgeRetrievalService.name);

    // Nhận các port ứng dụng và cấu hình đã chuẩn hóa; không phụ thuộc Nest ConfigService hay adapter cụ thể.
    constructor(
        @Inject(SELLER_KNOWLEDGE_REPOSITORY)
        private readonly repository: SellerKnowledgeRepositoryPort,
        @Inject(SELLER_KNOWLEDGE_EMBEDDING)
        private readonly embedding: SellerKnowledgeEmbeddingPort,
        @Inject(SELLER_KNOWLEDGE_RETRIEVAL_INDEX)
        private readonly retrievalIndex: SellerKnowledgeRetrievalIndexPort,
        @Inject(SELLER_KNOWLEDGE_RERANKER)
        private readonly reranker: SellerKnowledgeRerankerPort,
        @Inject(SELLER_KNOWLEDGE_RETRIEVAL_CONFIG)
        private readonly retrievalConfig: SellerKnowledgeRetrievalConfig,
    ) {}

    // Chỉ lấy revision PostgreSQL hiện cho phép, rồi tìm ứng viên và rerank theo câu hỏi đã được planner chuẩn hóa.
    // Lỗi reranker không làm gián đoạn chat: fallback giữ thứ tự RRF nhưng thu hẹp context; lỗi DB, embedding hoặc Qdrant vẫn được ném lên để retry.
    async retrieve(input: {
        query: string;
        domainCodes: string[];
        signal?: AbortSignal;
    }): Promise<SellerKnowledgeSearchHit[]> {
        // Kiểm tra hủy trước trim/DB để request đã đóng không phát sinh query hoặc phí embedding.
        const startedAt = Date.now();
        input.signal?.throwIfAborted();
        const query = input.query.trim();
        if (!query) return [];

        // Danh sách này là cổng cho phép cuối cùng; point Qdrant cũ không thể lọt lại sau khi publish, archive hoặc hết hạn.
        const scopes = await this.repository.listRetrievalScopes({
            domainCodes: input.domainCodes,
            language: this.retrievalConfig.language,
            asOf: new Date().toISOString().slice(0, 10),
        });
        if (!scopes.length) {
            // Không có revision được PostgreSQL cho phép thì kết luận rỗng ngay; không embed hay hỏi Qdrant.
            this.logRetrieval(0, 0, false, Date.now() - startedAt);
            return [];
        }
        input.signal?.throwIfAborted();

        // Dùng cùng model và dimension với lúc lập chỉ mục để vector câu hỏi so sánh được với vector tài liệu.
        const [queryVector] = await this.embedding.embed([query], input.signal);
        if (!queryVector?.length)
            throw new ServiceUnavailableException(
                'Embedding provider không tạo được vector truy vấn.',
            );
        input.signal?.throwIfAborted();

        // Hai nhánh dense và BM25 lấy candidate rộng; RRF hợp nhất theo thứ hạng, không cộng trực tiếp hai thang điểm khác nhau.
        const candidates = await this.retrievalIndex.search({
            query,
            queryVector,
            allowedRevisionIds: scopes.map((scope) => scope.revisionId),
            signal: input.signal,
            limit: this.retrievalConfig.candidateLimit,
        });
        if (!candidates.length) {
            // Candidate rỗng là kết quả hợp lệ; bỏ rerank với input rỗng và trả về không có evidence.
            this.logRetrieval(scopes.length, 0, false, Date.now() - startedAt);
            return [];
        }
        input.signal?.throwIfAborted();

        // Cohere chỉ nhận câu hỏi đã chuẩn hóa cùng tiêu đề/mục/nội dung; không gửi tenant ID hay metadata vận hành.
        let reranked: SellerKnowledgeSearchHit[];
        try {
            reranked = await this.reranker.rerank({
                query,
                hits: candidates,
                // Lấy đủ thứ hạng ứng viên trước khi áp giới hạn chunk/tài liệu; nếu chỉ rerank top context,
                // nhiều chunk đầu cùng tài liệu sẽ làm context bị hụt dù tài liệu khác có thứ hạng tốt phía sau.
                limit: candidates.length,
                signal: input.signal,
            });
        } catch {
            // Abort vẫn được ném ra; chỉ lỗi reranker mới hạ xuống fallback, tránh biến yêu cầu dừng thành câu trả lời tiếp tục.
            input.signal?.throwIfAborted();
            // Chỉ fallback khi adapter reranker lỗi; lỗi xử lý nội bộ sau rerank không bị che thành lỗi provider.
            // Giữ thứ tự RRF nhưng giảm số chunk để hạn chế đưa evidence yếu vào prompt.
            const fallback = this.limitPerDocument(
                candidates,
                this.retrievalConfig.fallbackLimit,
            );
            this.logRetrieval(
                scopes.length,
                candidates.length,
                true,
                Date.now() - startedAt,
            );
            return fallback;
        }

        const selected = this.limitPerDocument(
            reranked,
            this.retrievalConfig.contextLimit,
        );
        this.logRetrieval(
            scopes.length,
            candidates.length,
            false,
            Date.now() - startedAt,
        );
        return selected;
    }

    // Chỉ ghi telemetry tổng hợp; query, tenant ID, document ID và nội dung evidence không được đưa vào log.
    private logRetrieval(
        eligibleRevisionCount: number,
        candidateCount: number,
        usedFallback: boolean,
        latencyMs: number,
    ): void {
        this.logger.log(
            JSON.stringify({
                event: 'seller_knowledge_retrieved',
                eligibleRevisionCount,
                candidateCount,
                usedFallback,
                latencyMs,
            }),
        );
    }

    // Giới hạn số đoạn mỗi tài liệu để một tài liệu dài không chiếm toàn bộ prompt, đồng thời giữ nguyên thứ tự xếp hạng.
    private limitPerDocument(
        hits: SellerKnowledgeSearchHit[],
        limit: number,
    ): SellerKnowledgeSearchHit[] {
        // Đếm theo thứ tự rerank để giữ hit tốt nhất của mỗi tài liệu; chỉ sau đó mới áp tổng context limit.
        const maxPerDocument = this.retrievalConfig.maxChunksPerDocument;
        const seenByDocument = new Map<string, number>();
        return hits
            .filter((hit) => {
                const count = seenByDocument.get(hit.documentId) ?? 0;
                if (count >= maxPerDocument) return false;
                seenByDocument.set(hit.documentId, count + 1);
                return true;
            })
            .slice(0, limit);
    }
}
