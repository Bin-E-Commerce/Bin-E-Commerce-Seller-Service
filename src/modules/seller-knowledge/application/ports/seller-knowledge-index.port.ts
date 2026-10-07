import type {
    SellerKnowledgeDocumentRecord,
    SellerKnowledgeRevisionRecord,
} from '@/modules/seller-knowledge/application/types/seller-knowledge.types';

// Port embedding tách riêng khỏi vòng đời tài liệu để thay provider mà không đổi use case.
export const SELLER_KNOWLEDGE_EMBEDDING = Symbol('SELLER_KNOWLEDGE_EMBEDDING');
export interface SellerKnowledgeEmbeddingPort {
    // Giữ thứ tự và số lượng vector khớp inputs; signal dừng provider khi caller hủy publish/retrieval.
    embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>;
}

// Contract ghi revision tách khỏi Qdrant SDK; adapter hiện triển khai vector dense và sparse để phục vụ hybrid retrieval.
export const SELLER_KNOWLEDGE_VECTOR_INDEX = Symbol(
    'SELLER_KNOWLEDGE_VECTOR_INDEX',
);
export interface SellerKnowledgeVectorIndexPort {
    // Upsert toàn bộ chunk/vector và xác minh index trước khi trả; DB mới quyết định revision nào được query.
    publishRevision(input: {
        document: SellerKnowledgeDocumentRecord;
        revision: SellerKnowledgeRevisionRecord;
        chunks: {
            section: string;
            sectionPath: string[];
            content: string;
            chunkIndex: number;
        }[];
        vectors: number[][];
    }): Promise<void>;
}
