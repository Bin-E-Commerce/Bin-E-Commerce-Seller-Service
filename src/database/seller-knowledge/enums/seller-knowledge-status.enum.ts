// Trạng thái persistence của domain, tài liệu, revision và job lập chỉ mục.
// Các trạng thái riêng giữ rõ revision nháp với revision thật sự đang được chatbot sử dụng.
export enum SellerKnowledgeDomainStatus {
    DRAFT = 'DRAFT',
    ACTIVE = 'ACTIVE',
    ARCHIVED = 'ARCHIVED',
}

export enum SellerKnowledgeDocumentStatus {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
    EXPIRED = 'EXPIRED',
    ARCHIVED = 'ARCHIVED',
}

export enum SellerKnowledgeRevisionStatus {
    DRAFT = 'DRAFT',
    VALIDATED = 'VALIDATED',
    PUBLISHED = 'PUBLISHED',
    SUPERSEDED = 'SUPERSEDED',
    FAILED = 'FAILED',
}

export enum SellerKnowledgePublishJobStatus {
    QUEUED = 'QUEUED',
    RUNNING = 'RUNNING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
}
