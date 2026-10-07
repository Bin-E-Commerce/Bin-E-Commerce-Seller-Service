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
import type { SellerKnowledgeRetrievalScope } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

// Port chỉ công bố record và hành vi persistence cho application; SQL/TypeORM/transaction thuộc adapter infrastructure.
export const SELLER_KNOWLEDGE_REPOSITORY = Symbol(
    'SELLER_KNOWLEDGE_REPOSITORY',
);

export interface SellerKnowledgeRepositoryPort {
    // PostgreSQL là nguồn quyết định quyền truy xuất; chỉ trả revision hiện publish của domain knowledge đang active và còn hiệu lực.
    listRetrievalScopes(input: {
        domainCodes?: string[];
        language: string;
        asOf: string;
    }): Promise<SellerKnowledgeRetrievalScope[]>;
    // Liệt kê domain theo quyền hiển thị nháp; registry production phải gọi với includeDrafts=false.
    listDomains(includeDrafts: boolean): Promise<SellerKnowledgeDomainRecord[]>;
    // Tìm domain theo code ổn định để service kiểm tra loại và trạng thái trước mutation.
    findDomain(code: string): Promise<SellerKnowledgeDomainRecord | null>;
    // Lưu metadata domain đã được application ép kind/implementationKey theo allowlist.
    saveDomain(
        domain: Partial<SellerKnowledgeDomainRecord>,
    ): Promise<SellerKnowledgeDomainRecord>;
    // Cập nhật status và audit trong cùng transaction; null báo record đã mất trong lúc xử lý.
    setDomainStatus(
        code: string,
        status: SellerKnowledgeDomainStatus,
        actorId: string,
    ): Promise<SellerKnowledgeDomainRecord | null>;
    // Trả metadata tài liệu có giới hạn; nội dung Markdown vẫn ở object storage.
    listDocuments(query: {
        search?: string;
        domain?: string;
        status?: string;
    }): Promise<SellerKnowledgeDocumentRecord[]>;
    // Kiểm tra điều kiện có ít nhất một bản đã publish trước khi kích hoạt domain.
    hasPublishedDocumentsForDomain(domainCode: string): Promise<boolean>;
    // Chuyển tài liệu hết hạn theo ngày database trước khi hiển thị/admin dùng catalog.
    markExpiredDocuments(): Promise<void>;
    // Đọc metadata document; caller phải dùng storage port riêng nếu cần source Markdown.
    findDocument(id: string): Promise<SellerKnowledgeDocumentRecord | null>;
    // Tra slug để phát hiện xung đột thân thiện; database vẫn phải giữ unique constraint chống race.
    findDocumentBySlug(
        slug: string,
    ): Promise<SellerKnowledgeDocumentRecord | null>;
    // Cập nhật các trường metadata đã allowlist; không nhận nội dung Markdown hoặc thay source object.
    updateDocument(
        id: string,
        values: Partial<SellerKnowledgeDocumentRecord>,
    ): Promise<void>;
    // Compare-and-set chỉ khi đang ARCHIVED và audit cùng transaction; false báo trạng thái đã đổi/record không còn.
    restoreDocument(
        id: string,
        status: SellerKnowledgeDocumentRecord['status'],
        actorId: string,
    ): Promise<boolean>;
    // Lấy lịch sử revisions theo thứ tự số giảm dần để UI đối chiếu bản mới và bản đang active.
    listRevisions(documentId: string): Promise<SellerKnowledgeRevisionRecord[]>;
    // Đọc một revision để service xác minh document/status trước storage hoặc publish.
    findRevision(id: string): Promise<SellerKnowledgeRevisionRecord | null>;
    // Cập nhật validation/index metadata nhưng phải giữ source key/hash bất biến của revision.
    updateRevision(
        id: string,
        values: Partial<SellerKnowledgeRevisionRecord>,
    ): Promise<void>;
    // Tạo document và revision đầu tiên atomically để không tồn tại document chưa có revision.
    createDocument(
        document: Partial<SellerKnowledgeDocumentRecord>,
        revision: Partial<SellerKnowledgeRevisionRecord>,
    ): Promise<{
        document: SellerKnowledgeDocumentRecord;
        revision: SellerKnowledgeRevisionRecord;
    }>;
    // Cấp revision number và tạo revision mới trong transaction được khóa theo document.
    createRevision(
        revision: Partial<SellerKnowledgeRevisionRecord>,
        actorId: string,
    ): Promise<SellerKnowledgeRevisionRecord>;
    // Tạo job trước các lời gọi embedding/index để mọi lần publish đều có dấu vết vận hành.
    saveJob(
        job: Partial<SellerKnowledgePublishJobRecord>,
    ): Promise<SellerKnowledgePublishJobRecord>;
    // Chốt trạng thái revision/document/job/audit atomically; false nghĩa không còn đủ điều kiện kích hoạt.
    activateRevision(
        documentId: string,
        revisionId: string,
        jobId: string,
        actorId: string,
        documentMetadata: SellerKnowledgeDocumentMetadata,
    ): Promise<boolean>;
    // Đánh dấu job lỗi nhưng không đổi revision đang phục vụ.
    failJob(jobId: string, message: string): Promise<void>;
    // Ghi audit đã chuẩn hóa, không đưa source content/secret vào event.
    addAudit(event: SellerKnowledgeAuditInput): Promise<void>;
}
