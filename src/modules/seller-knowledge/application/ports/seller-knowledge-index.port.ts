import type {
    SellerKnowledgeDocumentRecord,
    SellerKnowledgeRevisionRecord,
} from '@/modules/seller-knowledge/application/types/seller-knowledge.types';

// Port embedding tách riêng khỏi vòng đời tài liệu để thay provider mà không đổi use case.
export const SELLER_KNOWLEDGE_EMBEDDING = Symbol('SELLER_KNOWLEDGE_EMBEDDING');
export interface SellerKnowledgeEmbeddingPort {
    embed(inputs: string[]): Promise<number[][]>;
}

// Payload index không ràng buộc Qdrant SDK; adapter dense hiện tại có thể được benchmark/thay mà không sửa service quản trị.
export const SELLER_KNOWLEDGE_VECTOR_INDEX = Symbol(
    'SELLER_KNOWLEDGE_VECTOR_INDEX',
);
export interface SellerKnowledgeVectorIndexPort {
    publishRevision(input: {
        document: SellerKnowledgeDocumentRecord;
        revision: SellerKnowledgeRevisionRecord;
        chunks: { section: string; content: string }[];
        vectors: number[][];
    }): Promise<void>;
}
