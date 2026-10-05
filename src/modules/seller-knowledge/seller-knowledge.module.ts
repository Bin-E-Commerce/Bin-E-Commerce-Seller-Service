import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SELLER_QUESTION_CAPABILITY_REGISTRY } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
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

// Feature sở hữu vòng đời tài liệu và cung cấp registry động cho planner; không thay public chat API/SSE.
@Module({
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
        SellerKnowledgeStorageClient,
        OpenAiSellerKnowledgeEmbeddingClient,
        QdrantSellerKnowledgeIndexClient,
        TypeOrmSellerKnowledgeRepository,
        {
            provide: SELLER_KNOWLEDGE_REPOSITORY,
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
        SellerKnowledgeRegistryProvider,
        {
            provide: SELLER_QUESTION_CAPABILITY_REGISTRY,
            useExisting: SellerKnowledgeRegistryProvider,
        },
    ],
    exports: [SELLER_QUESTION_CAPABILITY_REGISTRY],
})
export class SellerKnowledgeModule {}
