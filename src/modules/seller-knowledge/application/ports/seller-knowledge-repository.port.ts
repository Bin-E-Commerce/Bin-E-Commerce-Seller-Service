// Port giới hạn hợp đồng persistence cho application; chi tiết TypeORM và transaction thuộc repository hạ tầng.
import type {
    SellerKnowledgeAuditInput,
    SellerKnowledgeDomainRecord,
    SellerKnowledgeDomainStatus,
    SellerKnowledgeDocumentMetadata,
    SellerKnowledgeDocumentRecord,
    SellerKnowledgePublishJobRecord,
    SellerKnowledgeRevisionRecord,
} from '@/modules/seller-knowledge/application/types/seller-knowledge.types';

// Persistence port exposes application records only; SQL/TypeORM remain inside the infrastructure adapter.
export const SELLER_KNOWLEDGE_REPOSITORY = Symbol(
    'SELLER_KNOWLEDGE_REPOSITORY',
);

export interface SellerKnowledgeRepositoryPort {
    listDomains(includeDrafts: boolean): Promise<SellerKnowledgeDomainRecord[]>;
    findDomain(code: string): Promise<SellerKnowledgeDomainRecord | null>;
    saveDomain(
        domain: Partial<SellerKnowledgeDomainRecord>,
    ): Promise<SellerKnowledgeDomainRecord>;
    setDomainStatus(
        code: string,
        status: SellerKnowledgeDomainStatus,
        actorId: string,
    ): Promise<SellerKnowledgeDomainRecord | null>;
    listDocuments(query: {
        search?: string;
        domain?: string;
        status?: string;
    }): Promise<SellerKnowledgeDocumentRecord[]>;
    hasPublishedDocumentsForDomain(domainCode: string): Promise<boolean>;
    markExpiredDocuments(): Promise<void>;
    findDocument(id: string): Promise<SellerKnowledgeDocumentRecord | null>;
    findDocumentBySlug(
        slug: string,
    ): Promise<SellerKnowledgeDocumentRecord | null>;
    updateDocument(
        id: string,
        values: Partial<SellerKnowledgeDocumentRecord>,
    ): Promise<void>;
    restoreDocument(
        id: string,
        status: SellerKnowledgeDocumentRecord['status'],
        actorId: string,
    ): Promise<boolean>;
    listRevisions(documentId: string): Promise<SellerKnowledgeRevisionRecord[]>;
    findRevision(id: string): Promise<SellerKnowledgeRevisionRecord | null>;
    updateRevision(
        id: string,
        values: Partial<SellerKnowledgeRevisionRecord>,
    ): Promise<void>;
    createDocument(
        document: Partial<SellerKnowledgeDocumentRecord>,
        revision: Partial<SellerKnowledgeRevisionRecord>,
    ): Promise<{
        document: SellerKnowledgeDocumentRecord;
        revision: SellerKnowledgeRevisionRecord;
    }>;
    createRevision(
        revision: Partial<SellerKnowledgeRevisionRecord>,
        actorId: string,
    ): Promise<SellerKnowledgeRevisionRecord>;
    saveJob(
        job: Partial<SellerKnowledgePublishJobRecord>,
    ): Promise<SellerKnowledgePublishJobRecord>;
    activateRevision(
        documentId: string,
        revisionId: string,
        jobId: string,
        actorId: string,
        documentMetadata: SellerKnowledgeDocumentMetadata,
    ): Promise<boolean>;
    failJob(jobId: string, message: string): Promise<void>;
    addAudit(event: SellerKnowledgeAuditInput): Promise<void>;
}
