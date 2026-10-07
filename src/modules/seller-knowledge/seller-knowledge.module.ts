// Module đăng ký luồng quản trị/retrieval tài liệu và các adapter hạ tầng; quy tắc publish nằm trong application service.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SELLER_QUESTION_CAPABILITY_REGISTRY } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { SellerKnowledgeAuditEvent } from '@/database/seller-knowledge/entities/seller-knowledge-audit.entity';
import { SellerKnowledgeDocument } from '@/database/seller-knowledge/entities/seller-knowledge-document.entity';
import { SellerKnowledgeDomain } from '@/database/seller-knowledge/entities/seller-knowledge-domain.entity';
import { SellerKnowledgePublishJob } from '@/database/seller-knowledge/entities/seller-knowledge-publish-job.entity';
import { SellerKnowledgeRevision } from '@/database/seller-knowledge/entities/seller-knowledge-revision.entity';
import { SELLER_KNOWLEDGE_REPOSITORY } from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import { SellerKnowledgeService } from '@/modules/seller-knowledge/application/services/seller-knowledge.service';
import { SellerKnowledgeStorageClient } from '@/modules/seller-knowledge/application/clients/seller-knowledge-storage.client';
import { TypeOrmSellerKnowledgeRepository } from '@/modules/seller-knowledge/infrastructure/repositories/typeorm-seller-knowledge.repository';
import { OpenAiSellerKnowledgeEmbeddingClient } from '@/modules/seller-knowledge/infrastructure/clients/openai-seller-knowledge-embedding.client';
import { QdrantSellerKnowledgeIndexClient } from '@/modules/seller-knowledge/infrastructure/clients/qdrant-seller-knowledge-index.client';
import {
    SELLER_KNOWLEDGE_EMBEDDING,
    SELLER_KNOWLEDGE_VECTOR_INDEX,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import { SellerKnowledgeRegistryProvider } from '@/modules/seller-knowledge/infrastructure/registry/seller-knowledge-registry.provider';
import { SellerKnowledgeAdminController } from '@/modules/seller-knowledge/presentation/controllers/seller-knowledge-admin.controller';
import { SellerKnowledgeRetrievalService } from '@/modules/seller-knowledge/application/services/seller-knowledge-retrieval.service';
import { CohereSellerKnowledgeRerankerClient } from '@/modules/seller-knowledge/infrastructure/clients/cohere-seller-knowledge-reranker.client';
import {
    SELLER_KNOWLEDGE_RETRIEVAL_CONFIG,
    SELLER_KNOWLEDGE_RERANKER,
    SELLER_KNOWLEDGE_RETRIEVAL_INDEX,
    type SellerKnowledgeRetrievalConfig,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

// Đọc giới hạn từ cấu hình một lần lúc khởi động và chặn NaN/giá trị quá lớn trước khi đưa vào application service.
function readBoundedInteger(
    config: ConfigService,
    key: string,
    fallback: number,
    maximum: number,
): number {
    // Chuỗi rỗng giữ giá trị mặc định thay vì ép thành 0; mọi giá trị cấu hình khác sẽ đi qua cùng bước clamp bên dưới.
    const raw = config.get<string>(key, String(fallback));
    if (!raw.trim()) return fallback;
    const configured = Number(raw);
    // Giá trị sai định dạng quay về mặc định; giá trị hợp lệ được làm tròn xuống và giới hạn để bảo vệ chi phí/context.
    // NaN/Infinity dùng fallback; số hữu hạn được floor và chặn min/max để giới hạn truy vấn và kích thước context.
    return Number.isFinite(configured)
        ? Math.max(1, Math.min(Math.floor(configured), maximum))
        : fallback;
}

// Feature sở hữu vòng đời tài liệu và cung cấp registry động cho planner; không thay public chat API/SSE.
@Module({
    // Đăng ký entity chỉ trong feature; repository adapter là nơi duy nhất dùng TypeORM để truy vấn metadata.
    imports: [
        TypeOrmModule.forFeature([
            SellerKnowledgeDomain,
            SellerKnowledgeDocument,
            SellerKnowledgeRevision,
            SellerKnowledgePublishJob,
            SellerKnowledgeAuditEvent,
        ]),
    ],
    controllers: [SellerKnowledgeAdminController],
    providers: [
        SellerKnowledgeService,
        SellerKnowledgeRetrievalService,
        {
            provide: SELLER_KNOWLEDGE_RETRIEVAL_CONFIG,
            inject: [ConfigService],
            // Chuẩn hóa language và giới hạn riêng từng tầng retrieval để cấu hình vận hành không làm prompt/index phình không giới hạn.
            useFactory: (
                config: ConfigService,
            ): SellerKnowledgeRetrievalConfig => ({
                language:
                    config
                        .get<string>(
                            'SELLER_KNOWLEDGE_RETRIEVAL_LANGUAGE',
                            'vi',
                        )
                        .trim()
                        .toLowerCase() || 'vi',
                candidateLimit: readBoundedInteger(
                    config,
                    'SELLER_KNOWLEDGE_RERANK_CANDIDATE_LIMIT',
                    50,
                    100,
                ),
                contextLimit: readBoundedInteger(
                    config,
                    'SELLER_KNOWLEDGE_CONTEXT_LIMIT',
                    6,
                    12,
                ),
                fallbackLimit: readBoundedInteger(
                    config,
                    'SELLER_KNOWLEDGE_RERANK_FALLBACK_LIMIT',
                    3,
                    6,
                ),
                maxChunksPerDocument: readBoundedInteger(
                    config,
                    'SELLER_KNOWLEDGE_MAX_CHUNKS_PER_DOCUMENT',
                    2,
                    4,
                ),
            }),
        },
        SellerKnowledgeStorageClient,
        OpenAiSellerKnowledgeEmbeddingClient,
        QdrantSellerKnowledgeIndexClient,
        CohereSellerKnowledgeRerankerClient,
        TypeOrmSellerKnowledgeRepository,
        {
            provide: SELLER_KNOWLEDGE_REPOSITORY,
            // useExisting giữ một instance repository cho cả token cụ thể và port application.
            useExisting: TypeOrmSellerKnowledgeRepository,
        },
        {
            provide: SELLER_KNOWLEDGE_EMBEDDING,
            useExisting: OpenAiSellerKnowledgeEmbeddingClient,
        },
        {
            provide: SELLER_KNOWLEDGE_VECTOR_INDEX,
            useExisting: QdrantSellerKnowledgeIndexClient,
        },
        {
            provide: SELLER_KNOWLEDGE_RETRIEVAL_INDEX,
            useExisting: QdrantSellerKnowledgeIndexClient,
        },
        {
            provide: SELLER_KNOWLEDGE_RERANKER,
            useExisting: CohereSellerKnowledgeRerankerClient,
        },
        SellerKnowledgeRegistryProvider,
        {
            provide: SELLER_QUESTION_CAPABILITY_REGISTRY,
            useExisting: SellerKnowledgeRegistryProvider,
        },
    ],
    exports: [
        SELLER_QUESTION_CAPABILITY_REGISTRY,
        SellerKnowledgeRetrievalService,
    ],
})
export class SellerKnowledgeModule {}
