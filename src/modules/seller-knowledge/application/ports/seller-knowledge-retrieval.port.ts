// Cổng retrieval tách ứng dụng khỏi API cụ thể của Qdrant và nhà cung cấp rerank.
// PostgreSQL xác định revision hợp lệ; vector index chỉ trả ứng viên trong allowlist đó.
export interface SellerKnowledgeRetrievalScope {
    documentId: string;
    revisionId: string;
    title: string;
    domainCode: string;
    language: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
}

export interface SellerKnowledgeSearchHit extends SellerKnowledgeRetrievalScope {
    pointId: string;
    section: string;
    sectionPath: string[];
    content: string;
    score: number;
    version: string;
}

export interface SellerKnowledgeCitation {
    id: string;
    label: string;
    title?: string;
    sectionPath?: string[];
    type: 'seller_knowledge';
    excerpt: string;
    content: string;
    documentId: string;
    domain: string;
    version: string;
}

// Cấu hình nghiệp vụ retrieval đã được adapter chuẩn hóa; application không phụ thuộc ConfigService hoặc tên biến môi trường.
export interface SellerKnowledgeRetrievalConfig {
    language: string;
    candidateLimit: number;
    contextLimit: number;
    fallbackLimit: number;
    maxChunksPerDocument: number;
}

export const SELLER_KNOWLEDGE_RETRIEVAL_CONFIG = Symbol(
    'SELLER_KNOWLEDGE_RETRIEVAL_CONFIG',
);

export const SELLER_KNOWLEDGE_RETRIEVAL_INDEX = Symbol(
    'SELLER_KNOWLEDGE_RETRIEVAL_INDEX',
);

export interface SellerKnowledgeRetrievalIndexPort {
    // Tìm candidate chỉ trong allowlist revision do PostgreSQL cấp; index không tự quyết định quyền publish.
    search(input: {
        query: string;
        queryVector: number[];
        allowedRevisionIds: string[];
        limit: number;
        signal?: AbortSignal;
    }): Promise<SellerKnowledgeSearchHit[]>;
}

export const SELLER_KNOWLEDGE_RERANKER = Symbol('SELLER_KNOWLEDGE_RERANKER');

export interface SellerKnowledgeRerankerPort {
    // Sắp lại các hit hiện có, không tạo evidence mới; caller fallback khi provider lỗi và giữ limit hữu hạn.
    rerank(input: {
        query: string;
        hits: SellerKnowledgeSearchHit[];
        limit: number;
        signal?: AbortSignal;
    }): Promise<SellerKnowledgeSearchHit[]>;
}
