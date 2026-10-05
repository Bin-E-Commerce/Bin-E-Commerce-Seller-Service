// Model ứng dụng trung lập với TypeORM; use case và adapter trao đổi các record này qua port.
export type SellerKnowledgeDomainStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SellerKnowledgeDocumentStatus =
    'DRAFT' | 'PUBLISHED' | 'EXPIRED' | 'ARCHIVED';
export type SellerKnowledgeRevisionStatus =
    'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'SUPERSEDED' | 'FAILED';
export type SellerKnowledgePublishJobStatus =
    'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export type SellerKnowledgeDomainSource = 'SYSTEM' | 'ADMIN';

// Domain mô tả chủ đề; chỉ kind knowledge do Admin tạo, loại nguồn khác cần adapter backend.
export interface SellerKnowledgeDomainRecord {
    code: string;
    label: string;
    description: string;
    examples: string[];
    kind: 'knowledge' | 'live-data' | 'profile';
    implementationKey: string | null;
    status: SellerKnowledgeDomainStatus;
    createdBy: string;
    updatedBy: string;
    createdAt: Date;
    updatedAt: Date;
}

// View dành cho API quản trị; source được tính từ actor seed, không lưu thêm cột trong database.
export type SellerKnowledgeDomainResponse = SellerKnowledgeDomainRecord & {
    source: SellerKnowledgeDomainSource;
};

// Document là metadata có thể đổi; source và nội dung từng lần chỉnh sửa nằm ở revision riêng.
export interface SellerKnowledgeDocumentRecord {
    id: string;
    slug: string;
    title: string;
    domainCode: string;
    language: string;
    status: SellerKnowledgeDocumentStatus;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    publishedRevisionId: string | null;
    createdBy: string;
    updatedBy: string;
    createdAt: Date;
    updatedAt: Date;
}

// Snapshot metadata gắn với nội dung revision; bản nháp không được đổi thông tin của bản đang phát hành.
export interface SellerKnowledgeDocumentMetadata {
    slug: string;
    title: string;
    domainCode: string;
    language: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
}

// Revision là bản source bất biến, tham chiếu object storage bằng key và lưu hash để kiểm tra nguồn.
export interface SellerKnowledgeRevisionRecord {
    id: string;
    documentId: string;
    revisionNumber: number;
    sourceObjectKey: string;
    contentHash: string;
    contentSize: number;
    documentMetadata: SellerKnowledgeDocumentMetadata;
    status: SellerKnowledgeRevisionStatus;
    validationReport: Record<string, unknown> | null;
    createdBy: string;
    createdAt: Date;
}

// Publish job ghi kết quả lần tạo vector index để retry/audit không phụ thuộc request HTTP đã đóng hay chưa.
export interface SellerKnowledgePublishJobRecord {
    id: string;
    revisionId: string;
    status: SellerKnowledgePublishJobStatus;
    attempts: number;
    lastError: string | null;
    requestedBy: string;
    leaseUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

// Audit command là contract ứng dụng; adapter quyết định cách lưu append-only trong PostgreSQL.
export interface SellerKnowledgeAuditInput {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    revisionId?: string | null;
    details?: Record<string, unknown>;
}
