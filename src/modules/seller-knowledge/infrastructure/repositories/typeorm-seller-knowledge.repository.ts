// File chứa truy vấn PostgreSQL của Seller Knowledge; application chỉ gọi port, không phụ thuộc entity hay transaction ở đây.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SellerKnowledgeAuditEvent } from '@/database/seller-knowledge/entities/seller-knowledge-audit.entity';
import { SellerKnowledgeDocument } from '@/database/seller-knowledge/entities/seller-knowledge-document.entity';
import { SellerKnowledgeDomain } from '@/database/seller-knowledge/entities/seller-knowledge-domain.entity';
import { SellerKnowledgePublishJob } from '@/database/seller-knowledge/entities/seller-knowledge-publish-job.entity';
import { SellerKnowledgeRevision } from '@/database/seller-knowledge/entities/seller-knowledge-revision.entity';
import {
    SellerKnowledgeDocumentStatus,
    SellerKnowledgeDomainStatus,
    SellerKnowledgePublishJobStatus,
    SellerKnowledgeRevisionStatus,
} from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';
import type { SellerKnowledgeDocumentMetadata } from '@/modules/seller-knowledge/application/types/seller-knowledge.types';
import type { SellerKnowledgeRepositoryPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import type { SellerKnowledgeRetrievalScope } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

// Adapter duy nhất chứa truy vấn PostgreSQL cho catalog, revision metadata, publish job và audit Seller Knowledge.
@Injectable()
export class TypeOrmSellerKnowledgeRepository implements SellerKnowledgeRepositoryPort {
    // Inject repository theo từng entity để mọi truy vấn SQL/TypeORM nằm ở infrastructure, không lọt vào application service.
    constructor(
        @InjectRepository(SellerKnowledgeDomain)
        private readonly domains: Repository<SellerKnowledgeDomain>,
        @InjectRepository(SellerKnowledgeDocument)
        private readonly documents: Repository<SellerKnowledgeDocument>,
        @InjectRepository(SellerKnowledgeRevision)
        private readonly revisions: Repository<SellerKnowledgeRevision>,
        @InjectRepository(SellerKnowledgePublishJob)
        private readonly jobs: Repository<SellerKnowledgePublishJob>,
        @InjectRepository(SellerKnowledgeAuditEvent)
        private readonly audits: Repository<SellerKnowledgeAuditEvent>,
    ) {}

    // Tạo allowlist trực tiếp từ catalog chuẩn; point Qdrant cũ/bản nháp không lọt vào dù vẫn còn lưu trong index.
    // Join theo publishedRevisionId và trạng thái domain/document/revision đồng thời áp ngày hiệu lực ở PostgreSQL.
    async listRetrievalScopes(input: {
        domainCodes?: string[];
        language: string;
        asOf: string;
    }): Promise<SellerKnowledgeRetrievalScope[]> {
        const query = this.documents
            .createQueryBuilder('document')
            .innerJoin(
                SellerKnowledgeDomain,
                'domain',
                'domain.code = document.domainCode',
            )
            .innerJoin(
                SellerKnowledgeRevision,
                'revision',
                'revision.id = document.publishedRevisionId AND revision.documentId = document.id',
            )
            .select('document.id', 'documentId')
            .addSelect('revision.id', 'revisionId')
            .addSelect('document.title', 'title')
            .addSelect('document.domainCode', 'domainCode')
            .addSelect('document.language', 'language')
            .addSelect('document.effectiveFrom', 'effectiveFrom')
            .addSelect('document.effectiveTo', 'effectiveTo')
            .where('document.status = :published', { published: 'PUBLISHED' })
            .andWhere('revision.status = :revisionPublished', {
                revisionPublished: 'PUBLISHED',
            })
            .andWhere('domain.status = :active', { active: 'ACTIVE' })
            .andWhere('domain.kind = :kind', { kind: 'knowledge' })
            .andWhere(
                '(document.effectiveFrom IS NULL OR document.effectiveFrom <= :asOf)',
                { asOf: input.asOf },
            )
            .andWhere(
                '(document.effectiveTo IS NULL OR document.effectiveTo >= :asOf)',
                { asOf: input.asOf },
            )
            .andWhere('document.language = :language', {
                language: input.language,
            })
            .orderBy('document.id', 'ASC');

        // Khi planner không xác định domain, chỉ language/date giới hạn tập; có domain thì dùng exact allowlist, không mở lọc rộng.
        if (input.domainCodes?.length) {
            query.andWhere('document.domainCode IN (:...domainCodes)', {
                domainCodes: [...new Set(input.domainCodes)],
            });
        }

        return query.getRawMany<SellerKnowledgeRetrievalScope>();
    }

    // Draft chỉ hiện ở giao diện quản trị khi được yêu cầu; planner chỉ nhận domain ACTIVE.
    async listDomains(
        includeDrafts: boolean,
    ): Promise<SellerKnowledgeDomain[]> {
        return this.domains.find({
            where: includeDrafts
                ? {}
                : { status: SellerKnowledgeDomainStatus.ACTIVE },
            order: { label: 'ASC' },
        });
    }

    // Domain được tra riêng trước khi gắn tài liệu để chặn mã domain không tồn tại.
    async findDomain(code: string): Promise<SellerKnowledgeDomain | null> {
        return this.domains.findOne({ where: { code } });
    }

    // Lưu create/update domain; caller đã kiểm tra adapter và quyền trước khi gọi.
    async saveDomain(
        domain: Partial<SellerKnowledgeDomain>,
    ): Promise<SellerKnowledgeDomain> {
        return this.domains.save(this.domains.create(domain));
    }

    // Ghi trạng thái domain và audit trong cùng transaction: nếu audit thất bại, DB rollback cả thay đổi trạng thái.
    // Update theo code trả affected=0 nếu domain biến mất giữa chừng; khi đó trả null để service chuyển thành 404.
    async setDomainStatus(
        code: string,
        status: SellerKnowledgeDomainStatus,
        actorId: string,
    ): Promise<SellerKnowledgeDomain | null> {
        return this.domains.manager.transaction(async (manager) => {
            const updateResult = await manager.update(
                SellerKnowledgeDomain,
                { code },
                { status, updatedBy: actorId },
            );
            // Không ghi audit cho thao tác không cập nhật bản ghi nào; null phân biệt rõ race/deletion với thành công.
            if (!updateResult.affected) return null;

            await manager.save(
                SellerKnowledgeAuditEvent,
                manager.create(SellerKnowledgeAuditEvent, {
                    actorId,
                    action: `DOMAIN_${status}`,
                    entityType: 'domain',
                    entityId: code,
                    details: {},
                }),
            );
            // Đọc lại entity bên trong transaction để response chứa đúng giá trị vừa commit, không dùng bản cũ từ service.
            return manager.findOne(SellerKnowledgeDomain, { where: { code } });
        });
    }

    // Dựng query bằng các cột cố định; input chỉ đi qua parameter binding nên search không thể chèn SQL.
    // Giới hạn 200 metadata mới nhất để tránh tải toàn bộ catalog và không join/download source Markdown.
    async listDocuments(query: {
        search?: string;
        domain?: string;
        status?: string;
    }): Promise<SellerKnowledgeDocument[]> {
        const qb = this.documents
            .createQueryBuilder('document')
            .orderBy('document.updatedAt', 'DESC')
            .take(200);
        // Bỏ qua search rỗng sau trim; ILIKE cho phép tìm không phân biệt hoa thường trên title hoặc slug.
        if (query.search?.trim())
            qb.andWhere(
                '(document.title ILIKE :search OR document.slug ILIKE :search)',
                { search: `%${query.search.trim()}%` },
            );
        // Chỉ thêm từng filter khi có giá trị để query không vô tình loại toàn bộ document.
        if (query.domain)
            qb.andWhere('document.domainCode = :domain', {
                domain: query.domain,
            });
        if (query.status)
            qb.andWhere('document.status = :status', { status: query.status });
        // Trả entity metadata; content được lưu ngoài PostgreSQL và chỉ được đọc theo revision cụ thể.
        return qb.getMany();
    }

    // Dùng count thay vì tải danh sách; chỉ document đang PUBLISHED đủ điều kiện mở domain cho planner.
    async hasPublishedDocumentsForDomain(domainCode: string): Promise<boolean> {
        return (
            (await this.documents.count({
                where: {
                    domainCode,
                    status: SellerKnowledgeDocumentStatus.PUBLISHED,
                },
            })) > 0
        );
    }

    // Cập nhật trạng thái hết hiệu lực theo ngày UTC ở database trước khi trả catalog cho Admin.
    async markExpiredDocuments(): Promise<void> {
        await this.documents
            .createQueryBuilder()
            .update(SellerKnowledgeDocument)
            .set({ status: SellerKnowledgeDocumentStatus.EXPIRED })
            .where(
                'status = :published AND effective_to IS NOT NULL AND effective_to < CURRENT_DATE',
                { published: SellerKnowledgeDocumentStatus.PUBLISHED },
            )
            .execute();
    }

    // Nạp metadata document; nội dung luôn được lấy riêng từ object storage.
    async findDocument(id: string): Promise<SellerKnowledgeDocument | null> {
        return this.documents.findOne({ where: { id } });
    }

    // Slug là định danh public của tài liệu nên tra trước để trả lỗi xung đột có nghĩa thay vì lỗi unique thô.
    async findDocumentBySlug(
        slug: string,
    ): Promise<SellerKnowledgeDocument | null> {
        return this.documents.findOne({ where: { slug } });
    }

    // Update chỉ nhận các metadata đã được service allowlist; nội dung tài liệu không nằm trong entity này.
    async updateDocument(
        id: string,
        values: Partial<SellerKnowledgeDocument>,
    ): Promise<void> {
        await this.documents.update(id, values);
    }

    // Compare-and-set theo status ARCHIVED: chỉ request đầu tiên khôi phục được, request đồng thời sau đó nhận false.
    // Audit nằm trong cùng transaction nên không thể có trạng thái restored mà thiếu lịch sử thao tác.
    async restoreDocument(
        id: string,
        status: SellerKnowledgeDocumentStatus,
        actorId: string,
    ): Promise<boolean> {
        return this.documents.manager.transaction(async (manager) => {
            const updateResult = await manager.update(
                SellerKnowledgeDocument,
                { id, status: SellerKnowledgeDocumentStatus.ARCHIVED },
                { status, updatedBy: actorId },
            );
            // affected=0 nghĩa tài liệu không còn archived hoặc không tồn tại; giữ nguyên DB và báo caller xử lý conflict.
            if (!updateResult.affected) return false;

            await manager.save(
                SellerKnowledgeAuditEvent,
                manager.create(SellerKnowledgeAuditEvent, {
                    actorId,
                    action: 'DOCUMENT_RESTORE',
                    entityType: 'document',
                    entityId: id,
                    details: { status },
                }),
            );
            return true;
        });
    }

    // Trả revision mới nhất trước để UI thể hiện lịch sử và bản đang publish.
    async listRevisions(
        documentId: string,
    ): Promise<SellerKnowledgeRevision[]> {
        return this.revisions.find({
            where: { documentId },
            order: { revisionNumber: 'DESC' },
        });
    }

    // Tìm revision theo id để preview hoặc publish; document ownership được xác minh ở service.
    async findRevision(id: string): Promise<SellerKnowledgeRevision | null> {
        return this.revisions.findOne({ where: { id } });
    }

    // Lưu kết quả kiểm tra revision mà không thay source key/hash bất biến.
    async updateRevision(
        id: string,
        values: Partial<SellerKnowledgeRevision>,
    ): Promise<void> {
        await this.revisions.update(
            id,
            values as Parameters<
                Repository<SellerKnowledgeRevision>['update']
            >[1],
        );
    }

    // Tạo document gốc và revision đầu tiên cùng transaction để không tồn tại tài liệu rỗng nếu insert revision thất bại.
    // ID document sinh ở lần save đầu được gắn vào revision trong cùng transaction làm khóa liên kết nhất quán.
    async createDocument(
        document: Partial<SellerKnowledgeDocument>,
        revision: Partial<SellerKnowledgeRevision>,
    ): Promise<{
        document: SellerKnowledgeDocument;
        revision: SellerKnowledgeRevision;
    }> {
        return this.documents.manager.transaction(async (manager) => {
            // Lưu document trước vì DB sinh document.id, giá trị bắt buộc để gắn revision.
            const savedDocument = await manager.save(
                SellerKnowledgeDocument,
                manager.create(SellerKnowledgeDocument, document),
            );
            // Ghi revision thứ nhất cùng object key/hash/metadata; lỗi tại đây rollback luôn document vừa tạo.
            const savedRevision = await manager.save(
                SellerKnowledgeRevision,
                manager.create(SellerKnowledgeRevision, {
                    ...revision,
                    documentId: savedDocument.id,
                }),
            );
            return { document: savedDocument, revision: savedRevision };
        });
    }

    // Khóa document trước rồi đọc revision lớn nhất để hai lần save đồng thời được tuần tự hóa theo từng tài liệu.
    // Số revision mới được tính và insert trong một transaction, tránh cấp trùng số hoặc ghi đè revision bất biến.
    async createRevision(
        revision: Partial<SellerKnowledgeRevision>,
        actorId: string,
    ): Promise<SellerKnowledgeRevision> {
        return this.revisions.manager.transaction(async (manager) => {
            // Khóa hàng cha bảo vệ cả trường hợp chưa có revision nào, khi chưa có hàng revision để khóa.
            await manager.findOneOrFail(SellerKnowledgeDocument, {
                where: { id: revision.documentId },
                lock: { mode: 'pessimistic_write' },
            });
            // Chỉ cần revisionNumber cao nhất; pessimistic lock cùng transaction ngăn hai writer cùng đọc một số cũ.
            const rows = await manager.find(SellerKnowledgeRevision, {
                where: { documentId: revision.documentId },
                order: { revisionNumber: 'DESC' },
                take: 1,
                lock: { mode: 'pessimistic_write' },
            });
            // Tài liệu mới chưa có revision thì bắt đầu từ 1; nếu đã có thì tăng đúng một số sau bản mới nhất.
            const latest = rows[0];
            return manager.save(
                SellerKnowledgeRevision,
                manager.create(SellerKnowledgeRevision, {
                    ...revision,
                    revisionNumber: (latest?.revisionNumber ?? 0) + 1,
                    createdBy: actorId,
                }),
            );
        });
    }

    // Lưu job trước khi tác vụ embedding bắt đầu để có dấu vết kể cả khi provider lỗi giữa chừng.
    async saveJob(
        job: Partial<SellerKnowledgePublishJob>,
    ): Promise<SellerKnowledgePublishJob> {
        return this.jobs.save(this.jobs.create(job));
    }

    // Chỉ đổi revision active sau khi service đã ghi/xác minh Qdrant; transaction khóa document và revision để chống race.
    // Tất cả trạng thái revision/document/job/audit commit cùng nhau; trả false khi trạng thái không còn đủ điều kiện.
    async activateRevision(
        documentId: string,
        revisionId: string,
        jobId: string,
        actorId: string,
        documentMetadata: SellerKnowledgeDocumentMetadata,
    ): Promise<boolean> {
        return this.documents.manager.transaction(async (manager) => {
            const document = await manager.findOneOrFail(
                SellerKnowledgeDocument,
                {
                    where: { id: documentId },
                    lock: { mode: 'pessimistic_write' },
                },
            );
            const revision = await manager.findOne(SellerKnowledgeRevision, {
                where: { id: revisionId, documentId },
                lock: { mode: 'pessimistic_write' },
            });

            // Chốt lại trạng thái dưới cùng khóa transaction để thao tác archive hoặc publish đồng thời không lách kiểm tra của use case.
            // Kiểm tra lại dưới khóa DB vì trạng thái có thể đổi sau validation/embedding; không kích hoạt document archived.
            if (
                document.status === SellerKnowledgeDocumentStatus.ARCHIVED ||
                !revision ||
                ![
                    SellerKnowledgeRevisionStatus.DRAFT,
                    SellerKnowledgeRevisionStatus.VALIDATED,
                ].includes(revision.status)
            ) {
                return false;
            }
            // Đánh dấu bản active cũ SUPERSEDED trước khi chọn bản mới, chỉ khi hai ID khác nhau.
            if (
                document.publishedRevisionId &&
                document.publishedRevisionId !== revisionId
            ) {
                await manager.update(
                    SellerKnowledgeRevision,
                    { id: document.publishedRevisionId },
                    { status: SellerKnowledgeRevisionStatus.SUPERSEDED },
                );
            }
            // Đánh dấu revision đích PUBLISHED rồi chuyển metadata chuẩn và con trỏ publishedRevisionId trên document.
            await manager.update(
                SellerKnowledgeRevision,
                { id: revisionId },
                { status: SellerKnowledgeRevisionStatus.PUBLISHED },
            );
            // Job thành công và audit cùng transaction với pointer để lịch sử không báo thành công nếu activation rollback.
            await manager.update(
                SellerKnowledgeDocument,
                { id: documentId },
                {
                    slug: documentMetadata.slug,
                    title: documentMetadata.title,
                    domainCode: documentMetadata.domainCode,
                    language: documentMetadata.language,
                    effectiveFrom: documentMetadata.effectiveFrom,
                    effectiveTo: documentMetadata.effectiveTo,
                    publishedRevisionId: revisionId,
                    status: SellerKnowledgeDocumentStatus.PUBLISHED,
                    updatedBy: actorId,
                },
            );
            await manager.update(
                SellerKnowledgePublishJob,
                { id: jobId },
                {
                    status: SellerKnowledgePublishJobStatus.SUCCEEDED,
                    lastError: null,
                },
            );
            await manager.save(
                SellerKnowledgeAuditEvent,
                manager.create(SellerKnowledgeAuditEvent, {
                    actorId,
                    action: 'PUBLISH',
                    entityType: 'revision',
                    entityId: revisionId,
                    revisionId,
                    details: { documentId, jobId },
                }),
            );
            return true;
        });
    }

    // Chỉ ghi job thất bại và giới hạn thông báo lỗi để cột không nhận stack trace/chuỗi quá dài.
    // Không cập nhật document hay revision active; dữ liệu đang phục vụ vẫn nguyên vẹn.
    async failJob(jobId: string, message: string): Promise<void> {
        await this.jobs.update(jobId, {
            status: SellerKnowledgePublishJobStatus.FAILED,
            lastError: message.slice(0, 2000),
        });
    }

    // Tạo audit event từ actor/action/entity đã chuẩn hóa; không lưu source Markdown hay secret vào bảng lịch sử.
    async addAudit(event: Partial<SellerKnowledgeAuditEvent>): Promise<void> {
        await this.audits.save(this.audits.create(event));
    }
}
