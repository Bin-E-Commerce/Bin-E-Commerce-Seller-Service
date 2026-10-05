// File điều phối use case Seller Knowledge; dữ liệu persistence và transaction luôn đi qua repository port.
import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { SELLER_KNOWLEDGE_SYSTEM_ACTOR_ID } from '@/modules/seller-knowledge/application/constants/seller-knowledge-system.constants';
import type {
    SellerKnowledgeDomainRecord,
    SellerKnowledgeDomainResponse,
    SellerKnowledgeDocumentRecord,
    SellerKnowledgePublishJobRecord,
    SellerKnowledgeDocumentMetadata,
    SellerKnowledgeRevisionRecord,
} from '@/modules/seller-knowledge/application/types/seller-knowledge.types';
import { chunkSellerKnowledgeMarkdown } from '@/modules/seller-knowledge/application/utils/seller-knowledge-chunk.util';
import {
    SELLER_KNOWLEDGE_REPOSITORY,
    type SellerKnowledgeRepositoryPort,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import { SellerKnowledgeStorageClient } from '@/modules/seller-knowledge/application/clients/seller-knowledge-storage.client';
import {
    SELLER_KNOWLEDGE_EMBEDDING,
    SELLER_KNOWLEDGE_VECTOR_INDEX,
    type SellerKnowledgeEmbeddingPort,
    type SellerKnowledgeVectorIndexPort,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import type {
    CreateSellerKnowledgeDocumentDto,
    CreateSellerKnowledgeDomainDto,
} from '@/modules/seller-knowledge/presentation/dto/seller-knowledge.dto';

const MAX_MARKDOWN_BYTES = 64 * 1024;

// Use case quản lý tài liệu; metadata/audit qua repository, source qua S3 adapter, vector index qua Qdrant.
@Injectable()
export class SellerKnowledgeService {
    private readonly logger = new Logger(SellerKnowledgeService.name);

    // Repository chỉ giữ cổng thao tác metadata/audit; storage giữ Markdown gốc; embedding và vectorIndex chỉ được dùng khi preview/publish.
    // Tách các dependency theo trách nhiệm để luồng lưu DB không vô tình ghi Markdown trực tiếp vào PostgreSQL hoặc tự gọi Qdrant.
    constructor(
        @Inject(SELLER_KNOWLEDGE_REPOSITORY)
        private readonly repository: SellerKnowledgeRepositoryPort,
        private readonly storage: SellerKnowledgeStorageClient,
        @Inject(SELLER_KNOWLEDGE_EMBEDDING)
        private readonly embedding: SellerKnowledgeEmbeddingPort,
        @Inject(SELLER_KNOWLEDGE_VECTOR_INDEX)
        private readonly vectorIndex: SellerKnowledgeVectorIndexPort,
    ) {}

    // Danh sách admin giới hạn 200 bản ghi và chỉ tìm metadata, tránh kéo nội dung Markdown từ object storage hàng loạt.
    async listDocuments(query: {
        search?: string;
        domain?: string;
        status?: string;
    }): Promise<SellerKnowledgeDocumentRecord[]> {
        // Đánh dấu tài liệu quá hạn trước khi đọc danh sách để badge trạng thái không phụ thuộc lần chạy nền trước đó.
        await this.repository.markExpiredDocuments();
        // Repository áp dụng search/filter/giới hạn kết quả; service không tải Markdown cho danh sách metadata.
        return this.repository.listDocuments(query);
    }

    // Domain admin cần nguồn để UI tách nhóm hệ thống; chỉ knowledge có thể quản trị, live/profile giữ nguyên chỉ đọc.
    async listDomains(
        includeDrafts = true,
    ): Promise<SellerKnowledgeDomainResponse[]> {
        const domains = await this.repository.listDomains(includeDrafts);

        // Nguồn được suy ra từ actor seed đã dùng khi nạp registry, tránh cột DB hoặc danh sách mã bị nhân đôi ở web.
        return domains.map((domain) => this.toDomainResponse(domain));
    }

    // Tạo domain tài liệu mới; backend ép kind=knowledge nên cấu hình admin không thể mở nguồn dữ liệu hoặc quyền ghi.
    async createDomain(
        dto: CreateSellerKnowledgeDomainDto,
        actorId: string,
    ): Promise<SellerKnowledgeDomainResponse> {
        // Kiểm tra trùng mã trước khi lưu để trả lỗi nghiệp vụ rõ ràng thay cho lỗi unique constraint của DB.
        const existing = await this.repository.findDomain(dto.code);
        if (existing) throw new ConflictException('Mã domain đã được sử dụng.');
        // Domain mới phải đi qua kiểm thử có tài liệu rồi mới ACTIVE; không cho tạo thẳng nhóm rỗng có thể được planner chọn.
        if (dto.status === 'ACTIVE')
            throw new BadRequestException(
                'Domain mới cần được tạo ở trạng thái nháp; hãy xuất bản ít nhất một tài liệu rồi mới kích hoạt.',
            );
        // Chuẩn hóa từng ví dụ và giới hạn số lượng để registry không phình theo input quản trị.
        const examples = (dto.examples ?? '')
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 20);
        // Backend cố định kind/implementationKey: admin chỉ tạo domain knowledge, không thể đăng ký adapter nghiệp vụ.
        const domain = await this.repository.saveDomain({
            code: dto.code,
            label: dto.label.trim(),
            description: dto.description.trim(),
            examples,
            kind: 'knowledge',
            implementationKey: null,
            status: 'DRAFT',
            createdBy: actorId,
            updatedBy: actorId,
        });
        // Lưu actor và hành động sau khi domain tạo thành công để hỗ trợ truy vết ai đã thay đổi registry.
        await this.repository.addAudit({
            actorId,
            action: 'DOMAIN_CREATE',
            entityType: 'domain',
            entityId: domain.code,
            details: { status: domain.status },
        });
        return this.toDomainResponse(domain);
    }

    // Chỉ kích hoạt domain khi đã có tài liệu xuất bản; thao tác ngừng dùng được phép dù domain chưa có tài liệu.
    // Kiểm tra tồn tại và loại domain trước để không thay đổi nguồn live/profile do backend quản lý riêng.
    // Repository ghi trạng thái cùng audit trong một transaction; lỗi giữa chừng không để lại trạng thái nửa cập nhật.
    async setDomainStatus(
        code: string,
        status: 'ACTIVE' | 'ARCHIVED',
        actorId: string,
    ): Promise<SellerKnowledgeDomainResponse> {
        // Đọc trạng thái hiện tại trước để phân biệt domain không tồn tại với domain loại khác do hệ thống quản lý.
        const domain = await this.repository.findDomain(code);
        if (!domain) throw new NotFoundException('Không tìm thấy domain.');
        if (domain.kind !== 'knowledge')
            throw new BadRequestException(
                'Domain nguồn live/hồ sơ chỉ được quản lý bằng backend adapter.',
            );
        // Chỉ cần kiểm tra có tài liệu published khi chuyển từ trạng thái không hoạt động sang ACTIVE.
        // Yêu cầu ACTIVE lặp lại là idempotent, còn ARCHIVED luôn được phép để admin có thể ngừng dùng nhóm khẩn cấp.
        if (
            status === 'ACTIVE' &&
            domain.status !== 'ACTIVE' &&
            !(await this.repository.hasPublishedDocumentsForDomain(code))
        )
            throw new BadRequestException(
                'Domain cần có ít nhất một tài liệu đã xuất bản trước khi kích hoạt.',
            );
        // Repository ghi trạng thái và audit atomically; null nghĩa domain đã bị xóa giữa lần đọc và lần cập nhật.
        const saved = await this.repository.setDomainStatus(
            code,
            status,
            actorId,
        );
        if (!saved) throw new NotFoundException('Không tìm thấy domain.');
        return this.toDomainResponse(saved);
    }

    // Chuẩn hóa response cho cả list và mutation bằng actor seed đã lưu, tránh suy luận nguồn từ mã domain ở frontend.
    // Hàm không ghi DB; chỉ thêm nhãn nguồn SYSTEM/ADMIN vào bản ghi vừa đọc.
    private toDomainResponse(
        domain: SellerKnowledgeDomainRecord,
    ): SellerKnowledgeDomainResponse {
        return {
            ...domain,
            source:
                domain.createdBy === SELLER_KNOWLEDGE_SYSTEM_ACTOR_ID
                    ? 'SYSTEM'
                    : 'ADMIN',
        };
    }

    // Tạo tài liệu knowledge kể cả khi domain đang ngừng sử dụng để admin chuẩn bị dữ liệu khôi phục.
    // Domain ARCHIVED vẫn bị loại khỏi registry planner, nên bản nháp/published chưa được dùng trước khi admin kích hoạt lại.
    // Source được ghi S3 trước transaction metadata; nếu persistence lỗi thì dọn object mồ côi và giữ lỗi DB gốc.
    async createDocument(
        dto: CreateSellerKnowledgeDocumentDto,
        actorId: string,
    ): Promise<{
        document: SellerKnowledgeDocumentRecord;
        revision: SellerKnowledgeRevisionRecord;
    }> {
        // Tìm domain trước khi tạo object ngoài DB để domain sai không sinh file Markdown mồ côi.
        const domain = await this.repository.findDomain(dto.domainCode);
        // ARCHIVED chỉ ngăn planner sử dụng nhóm; admin vẫn cần tạo draft để phục hồi một nhóm chưa có tài liệu.
        if (!domain || domain.kind !== 'knowledge')
            throw new BadRequestException('Domain tài liệu không hợp lệ.');
        // Slug phải duy nhất trước khi gọi storage; DB vẫn bảo vệ bằng constraint nếu có request đồng thời.
        if (await this.repository.findDocumentBySlug(dto.slug))
            throw new ConflictException('Đường dẫn tài liệu đã được sử dụng.');
        // Chuẩn hóa newline/trim và kiểm tra dung lượng/thẻ cấm trước mọi I/O lưu trữ.
        const markdown = this.validateMarkdown(dto.markdown);
        this.validateDates(dto.effectiveFrom, dto.effectiveTo);
        // Dùng revision UUID làm định danh object; cùng ID được lưu ở PostgreSQL để đọc lại chính xác source này.
        const revisionId = randomUUID();
        const objectKey = await this.storage.store(revisionId, markdown);
        // DB chỉ lưu object key, hash, kích thước, metadata và trạng thái; toàn bộ Markdown vẫn ở Media/S3.
        const revision = {
            id: revisionId,
            revisionNumber: 1,
            sourceObjectKey: objectKey,
            contentHash: createHash('sha256').update(markdown).digest('hex'),
            contentSize: Buffer.byteLength(markdown, 'utf8'),
            documentMetadata: this.toDocumentMetadata(dto),
            status: 'DRAFT' as const,
            validationReport: null,
            createdBy: actorId,
        };
        let result: Awaited<
            ReturnType<SellerKnowledgeRepositoryPort['createDocument']>
        >;
        // Source đã upload trước transaction nên nếu transaction insert document/revision thất bại cần bù trừ object đó.
        try {
            result = await this.repository.createDocument(
                {
                    slug: dto.slug,
                    title: dto.title.trim(),
                    domainCode: dto.domainCode,
                    language: dto.language ?? 'vi',
                    status: 'DRAFT',
                    effectiveFrom: dto.effectiveFrom ?? null,
                    effectiveTo: dto.effectiveTo ?? null,
                    publishedRevisionId: null,
                    createdBy: actorId,
                    updatedBy: actorId,
                },
                revision,
            );
        } catch (error) {
            // S3 đã nhận source nhưng transaction có thể rollback; xóa object mồ côi mà vẫn giữ nguyên lỗi DB gốc.
            await this.cleanupOrphanedSource(revisionId);
            throw error;
        }
        // Audit ghi nhận tạo tài liệu sau transaction chính; nếu audit lỗi, dữ liệu tài liệu vẫn đã được commit.
        await this.repository.addAudit({
            actorId,
            action: 'DOCUMENT_CREATE',
            entityType: 'document',
            entityId: result.document.id,
            revisionId,
            details: { domainCode: dto.domainCode },
        });
        return result;
    }

    // Tạo revision mới bất biến; cho phép soạn trong domain archived nhưng planner vẫn không dùng domain đó.
    // Bản published cũ không bị ghi đè; chỉ thao tác kích hoạt domain sau publish mới đưa kiến thức trở lại chatbot.
    async saveRevision(
        documentId: string,
        dto: CreateSellerKnowledgeDocumentDto,
        actorId: string,
    ): Promise<SellerKnowledgeRevisionRecord> {
        // Không cho thêm revision vào document đã archived; trước đó document được xác nhận tồn tại để trả 404 đúng nghĩa.
        const document = await this.requireDocument(documentId);
        if (document.status === 'ARCHIVED')
            throw new ConflictException(
                'Không thể tạo phiên bản mới cho tài liệu đã lưu trữ.',
            );
        // Domain archived vẫn cho phép chuẩn bị revision; trạng thái domain chỉ chặn planner dùng kiến thức, không chặn biên tập.
        const domain = await this.repository.findDomain(dto.domainCode);
        // Cho phép sửa nội dung trong domain archived để chuẩn bị lần publish tiếp theo; document archived vẫn bị chặn riêng.
        if (!domain || domain.kind !== 'knowledge')
            throw new BadRequestException('Domain tài liệu không hợp lệ.');
        // Khi sửa cùng tài liệu, slug hiện tại của chính nó được phép; chỉ xung đột với document ID khác mới bị từ chối.
        const existingSlug = await this.repository.findDocumentBySlug(dto.slug);
        if (existingSlug && existingSlug.id !== documentId)
            throw new ConflictException('Đường dẫn tài liệu đã được sử dụng.');
        const markdown = this.validateMarkdown(dto.markdown);
        this.validateDates(dto.effectiveFrom, dto.effectiveTo);
        // Mỗi lần lưu tạo ID/object mới để revision cũ không bị ghi đè và lịch sử có thể phục hồi được.
        const revisionId = randomUUID();
        const objectKey = await this.storage.store(revisionId, markdown);
        let revision: SellerKnowledgeRevisionRecord;
        // Ghi revision metadata sau upload; nếu insert lỗi, dọn đúng object vừa tạo chứ không đụng các revision trước.
        try {
            revision = await this.repository.createRevision(
                {
                    id: revisionId,
                    documentId,
                    sourceObjectKey: objectKey,
                    contentHash: createHash('sha256')
                        .update(markdown)
                        .digest('hex'),
                    contentSize: Buffer.byteLength(markdown, 'utf8'),
                    status: 'DRAFT',
                    documentMetadata: this.toDocumentMetadata(dto),
                },
                actorId,
            );
        } catch (error) {
            // Chỉ bù trừ khi insert revision thất bại; object của revision đã lưu thành công vẫn giữ nguyên.
            await this.cleanupOrphanedSource(revisionId);
            throw error;
        }
        // Audit gắn revision mới với document để lịch sử thao tác phân biệt rõ việc tạo tài liệu và cập nhật.
        await this.repository.addAudit({
            actorId,
            action: 'REVISION_CREATE',
            entityType: 'document',
            entityId: documentId,
            revisionId,
            details: {},
        });
        return revision;
    }

    // Trả document metadata và lịch sử revision; nội dung Markdown chỉ được đọc ở preview/publish để tránh tải thừa.
    async getDocument(documentId: string): Promise<{
        document: SellerKnowledgeDocumentRecord;
        revisions: SellerKnowledgeRevisionRecord[];
    }> {
        return {
            document: await this.requireDocument(documentId),
            revisions: await this.repository.listRevisions(documentId),
        };
    }

    // Archive chỉ chuyển trạng thái document; source và point Qdrant được giữ lại để audit/rollback.
    // Xác nhận document tồn tại trước cập nhật để trả 404 có nghĩa, sau đó lưu audit cho thao tác quản trị.
    async archiveDocument(documentId: string, actorId: string): Promise<void> {
        await this.requireDocument(documentId);
        await this.repository.updateDocument(documentId, {
            status: 'ARCHIVED',
            updatedBy: actorId,
        });
        await this.repository.addAudit({
            actorId,
            action: 'DOCUMENT_ARCHIVE',
            entityType: 'document',
            entityId: documentId,
            details: {},
        });
    }

    // Khôi phục tài liệu về DRAFT/PUBLISHED/EXPIRED dựa trên revision và hạn dùng đã giữ khi ngừng.
    // Không tự kích hoạt domain: việc domain hoạt động vẫn là bước riêng có điều kiện và quyền quản lý riêng.
    // Repository chỉ cập nhật nếu trạng thái vẫn ARCHIVED và ghi audit cùng transaction để tránh khôi phục đúp.
    async restoreDocument(documentId: string, actorId: string): Promise<void> {
        const document = await this.requireDocument(documentId);
        if (document.status !== 'ARCHIVED')
            throw new ConflictException(
                'Tài liệu hiện không ở trạng thái ngừng sử dụng.',
            );

        // Chưa từng publish thì khôi phục về DRAFT; nếu đã publish, ngày hết hạn quyết định EXPIRED hay PUBLISHED.
        // So sánh ngày ISO YYYY-MM-DD theo thứ tự từ vựng là an toàn vì hai vế cùng định dạng và múi giờ nghiệp vụ.
        const hasExpired = Boolean(
            document.effectiveTo &&
            document.effectiveTo < new Date().toISOString().slice(0, 10),
        );
        const restoredStatus = !document.publishedRevisionId
            ? 'DRAFT'
            : hasExpired
              ? 'EXPIRED'
              : 'PUBLISHED';
        // Repository chỉ restore nếu DB vẫn ARCHIVED; false báo có request đồng thời đã đổi trạng thái, cần tải lại UI.
        const restored = await this.repository.restoreDocument(
            documentId,
            restoredStatus,
            actorId,
        );
        if (!restored)
            throw new ConflictException(
                'Trạng thái tài liệu đã thay đổi. Hãy tải lại rồi thử lại.',
            );
    }

    // Nạp source theo revision ID, trả Markdown/chunks và lỗi kiểm tra để admin review trước khi publish.
    // Preview không gọi embedding hoặc Qdrant, nên thao tác này không làm bản nháp xuất hiện trong retrieval production.
    async preview(revisionId: string): Promise<{
        markdown: string;
        chunks: { section: string; content: string }[];
        validation: { valid: boolean; errors: string[] };
    }> {
        // Kiểm tra revision tồn tại trước khi dùng ID để yêu cầu Media đọc object.
        await this.requireRevision(revisionId);
        const markdown = await this.storage.read(revisionId);
        // Dùng cùng validator và chunker với publish để preview phản ánh đúng kết quả thực tế của lần phát hành.
        const errors = this.validateMarkdownContent(markdown);
        const chunks = chunkSellerKnowledgeMarkdown(markdown);
        if (!chunks.length)
            errors.push('Tài liệu chưa có nội dung để lập chỉ mục.');
        return {
            markdown,
            chunks,
            validation: { valid: errors.length === 0, errors },
        };
    }

    // Tạo embedding tạm cho câu hỏi và từng chunk rồi xếp hạng cosine để admin kiểm tra chất lượng retrieval trước publish.
    // Chỉ gọi provider embedding; không lưu vector thử vào Qdrant nên kết quả không ảnh hưởng câu trả lời của seller.
    async testDraft(
        revisionId: string,
        question: string,
    ): Promise<{
        revisionId: string;
        matches: { section: string; content: string; score: number }[];
    }> {
        // Chặn revision ID không tồn tại trước khi đọc object storage.
        await this.requireRevision(revisionId);
        const markdown = await this.storage.read(revisionId);
        const chunks = chunkSellerKnowledgeMarkdown(markdown);
        // Không gọi OpenAI với batch rỗng; trả kết quả rỗng rõ ràng nếu Markdown chưa có phần có nội dung.
        if (!chunks.length) return { revisionId, matches: [] };
        // Vector đầu tiên đại diện câu hỏi; các vector sau lần lượt đại diện chunk nên index chunk phải cộng thêm một.
        const vectors = await this.embedding.embed([
            question,
            ...chunks.map((chunk) => `${chunk.section}\n${chunk.content}`),
        ]);
        // Ghép score với chunk tương ứng, sắp xếp giảm dần và chỉ trả tối đa 5 kết quả hữu ích cho màn hình kiểm tra.
        return {
            revisionId,
            matches: chunks
                .map((chunk, index) => ({
                    ...chunk,
                    score: this.cosine(vectors[0]!, vectors[index + 1]!),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 5),
        };
    }

    // Cho phép publish tài liệu trong domain archived để tạo căn cứ khôi phục; registry vẫn chặn planner dùng domain đó.
    // Publish job được lưu trước I/O; Qdrant nhận đủ points trước khi PostgreSQL đổi con trỏ revision đang dùng.
    async publish(
        revisionId: string,
        actorId: string,
    ): Promise<SellerKnowledgePublishJobRecord> {
        // Nạp revision và document metadata trước khi đọc source; từ metadata snapshot xác định đúng domain/hiệu lực của bản này.
        const revision = await this.requireRevision(revisionId);
        const document = await this.requireDocument(revision.documentId);
        const metadata = revision.documentMetadata;
        const domain = await this.repository.findDomain(metadata.domainCode);
        // Publish trong domain archived chỉ lập chỉ mục; registry planner vẫn loại nhóm tới khi admin chuyển ACTIVE.
        if (!domain || domain.kind !== 'knowledge')
            throw new BadRequestException('Domain tài liệu không hợp lệ.');
        // Domain archived vẫn cho phép tạo index chuẩn bị, nhưng document archived bị chặn độc lập để không phát hành bản đã ngừng.
        if (document.status === 'ARCHIVED')
            throw new ConflictException(
                'Không thể xuất bản tài liệu đã lưu trữ.',
            );
        if (!['DRAFT', 'VALIDATED'].includes(revision.status))
            throw new ConflictException(
                'Chỉ có thể xuất bản bản nháp hợp lệ; hãy tạo revision mới nếu muốn phát hành lại nội dung cũ.',
            );
        // Xác thực thời hạn lần cuối ở publish vì revision có thể được lưu từ lâu hoặc đã hết hạn sau lúc tạo.
        this.validateDates(metadata.effectiveFrom, metadata.effectiveTo);
        if (
            metadata.effectiveTo &&
            metadata.effectiveTo < new Date().toISOString().slice(0, 10)
        )
            throw new BadRequestException(
                'Ngày hết hiệu lực đã qua; hãy cập nhật thời hạn trong revision mới.',
            );
        // Đọc và kiểm tra source trước khi tạo job hoặc gọi dịch vụ tốn thời gian, để lỗi nội dung không sinh job chạy dở.
        const markdown = await this.storage.read(revisionId);
        const errors = this.validateMarkdownContent(markdown);
        const chunks = chunkSellerKnowledgeMarkdown(markdown);
        if (errors.length || !chunks.length)
            throw new BadRequestException({
                message: 'Tài liệu chưa đạt kiểm tra xuất bản.',
                errors,
            });
        // Lưu job RUNNING trước các lời gọi ngoài để có dấu vết vận hành nếu embedding hoặc Qdrant thất bại.
        const job = await this.repository.saveJob({
            revisionId,
            requestedBy: actorId,
            status: 'RUNNING',
            attempts: 1,
            lastError: null,
            leaseUntil: null,
        });
        // Mỗi chunk được embed với tiêu đề và section làm ngữ cảnh; sau đó vector được ghép cùng chunk và ghi Qdrant.
        // Cả embedding lẫn Qdrant phải thành công trước khi revision được xác nhận indexed/validated.
        try {
            const vectors = await this.embedding.embed(
                chunks.map(
                    (chunk) =>
                        `${metadata.title}\n${chunk.section}\n${chunk.content}`,
                ),
            );
            await this.vectorIndex.publishRevision({
                document: { ...document, ...metadata },
                revision,
                chunks,
                vectors,
            });
            await this.repository.updateRevision(revision.id, {
                status: 'VALIDATED',
                validationReport: { chunkCount: chunks.length, indexed: true },
            });
        } catch (error) {
            // Ghi job/audit lỗi và không đổi con trỏ publishedRevisionId; revision cũ vẫn là nguồn retrieval chính thức.
            const message =
                error instanceof Error ? error.message : 'Indexing failed.';
            await this.recordPublishFailure(
                job.id,
                revision.id,
                actorId,
                message,
            );
            throw new ServiceUnavailableException(
                'Chưa thể xuất bản tài liệu; bản đang sử dụng vẫn được giữ nguyên.',
            );
        }

        // Chỉ sau khi Qdrant xác nhận đủ dữ liệu mới transaction PostgreSQL đổi revision active.
        // Nếu trạng thái bị thay đổi đồng thời, repository trả false; nếu DB lỗi, bản cũ vẫn là con trỏ chính thức.
        try {
            const activated = await this.repository.activateRevision(
                document.id,
                revision.id,
                job.id,
                actorId,
                metadata,
            );
            // Phát hiện document/revision đổi trạng thái giữa lúc index và activation để không kích hoạt stale revision.
            if (!activated) {
                await this.recordPublishFailure(
                    job.id,
                    revision.id,
                    actorId,
                    'Revision hoặc tài liệu đã đổi trạng thái trong lúc xuất bản.',
                );
                throw new ConflictException(
                    'Tài liệu đã thay đổi trạng thái trong lúc xuất bản. Vui lòng tải lại và thử lại.',
                );
            }
        } catch (error) {
            // Conflict đã được chuyển đúng nghĩa ở nhánh trên; lỗi còn lại là lỗi activation hạ tầng và được lưu vào job.
            if (error instanceof ConflictException) throw error;
            const message =
                error instanceof Error ? error.message : 'Activation failed.';
            await this.recordPublishFailure(
                job.id,
                revision.id,
                actorId,
                message,
            );
            throw new ServiceUnavailableException(
                'Chưa thể kích hoạt phiên bản mới; phiên bản đang dùng vẫn được giữ nguyên.',
            );
        }
        return { ...job, status: 'SUCCEEDED', lastError: null };
    }

    // Rollback không sửa/xóa revision cũ: copy source cũ thành revision draft mới, audit lý do, rồi dùng cùng pipeline publish.
    // Trước khi copy, xác nhận document còn hoạt động và revision đích thuộc đúng document để ngăn lẫn dữ liệu chéo.
    async rollback(
        documentId: string,
        targetRevisionId: string,
        actorId: string,
        reason: string,
    ): Promise<SellerKnowledgePublishJobRecord> {
        const document = await this.requireDocument(documentId);
        if (document.status === 'ARCHIVED')
            throw new ConflictException(
                'Không thể khôi phục revision của tài liệu đã lưu trữ.',
            );
        // Tìm bản cần khôi phục rồi xác minh quan hệ document trước khi đọc source của nó.
        const target = await this.requireRevision(targetRevisionId);
        if (target.documentId !== documentId)
            throw new BadRequestException('Revision không thuộc tài liệu này.');
        // Nội dung revision cũ là nguồn để tạo revision mới; ID mới giúp giữ nguyên lịch sử và object cũ.
        const markdown = await this.storage.read(target.id);
        const newId = randomUUID();
        const objectKey = await this.storage.store(newId, markdown);
        let revision: SellerKnowledgeRevisionRecord;
        // Lưu source mới trước metadata; nếu DB lỗi thì bù trừ object mới mà không xóa source đích cũ.
        try {
            revision = await this.repository.createRevision(
                {
                    id: newId,
                    documentId,
                    sourceObjectKey: objectKey,
                    contentHash: target.contentHash,
                    contentSize: target.contentSize,
                    status: 'DRAFT',
                    documentMetadata: target.documentMetadata,
                    validationReport: { rollbackFromRevisionId: target.id },
                },
                actorId,
            );
        } catch (error) {
            // Rollback cũng tạo source mới trước DB nên dọn object nếu revision audit trail không thể được lưu.
            await this.cleanupOrphanedSource(newId);
            throw error;
        }
        // Ghi actor và reason trước khi chạy publish để request rollback có dấu vết kể cả khi index thất bại.
        await this.repository.addAudit({
            actorId,
            action: 'ROLLBACK_REQUEST',
            entityType: 'document',
            entityId: documentId,
            revisionId: revision.id,
            details: {
                rollbackFromRevisionId: target.id,
                reason: reason.trim(),
            },
        });
        // Tái sử dụng publish để rollback cũng phải qua validate, embedding, Qdrant và transaction activation giống revision mới.
        return this.publish(revision.id, actorId);
    }

    // Chuẩn hóa DTO thành snapshot metadata bất biến gắn với revision; các bước preview/index/publish không đọc metadata mới từ UI.
    private toDocumentMetadata(
        dto: CreateSellerKnowledgeDocumentDto,
    ): SellerKnowledgeDocumentMetadata {
        return {
            slug: dto.slug,
            title: dto.title.trim(),
            domainCode: dto.domainCode,
            language: dto.language ?? 'vi',
            effectiveFrom: dto.effectiveFrom ?? null,
            effectiveTo: dto.effectiveTo ?? null,
        };
    }

    // Đánh dấu job thất bại và ghi audit phục vụ vận hành; message đầy đủ ở job, còn audit bị giới hạn để tránh log quá lớn.
    // Hàm không cập nhật document hay publishedRevisionId để lỗi publish không làm gián đoạn bản đang dùng.
    private async recordPublishFailure(
        jobId: string,
        revisionId: string,
        actorId: string,
        message: string,
    ): Promise<void> {
        await this.repository.failJob(jobId, message);
        await this.repository.addAudit({
            actorId,
            action: 'PUBLISH_FAILED',
            entityType: 'revision',
            entityId: revisionId,
            revisionId,
            details: { jobId, error: message.slice(0, 500) },
        });
    }

    // Bù trừ upload sau lỗi DB theo hướng an toàn: chỉ xóa object khi xác nhận revision không tồn tại.
    // Nếu DB không đọc được hoặc Media không xóa được, giữ source và chỉ log cảnh báo để tránh mất dữ liệu đã commit.
    private async cleanupOrphanedSource(revisionId: string): Promise<void> {
        // Kết nối DB có thể timeout sau commit; kiểm tra revision trước để không xóa nhầm object đã được metadata tham chiếu.
        try {
            // Lỗi kết nối có thể xảy ra sau khi transaction đã commit; chỉ xóa S3 khi DB xác nhận revision chưa tồn tại.
            if (await this.repository.findRevision(revisionId)) return;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown error';
            this.logger.warn(
                `Không xác minh được revision ${revisionId}; giữ source để tránh làm hỏng dữ liệu đã commit: ${message}`,
            );
            return;
        }

        // Chỉ tới đây khi DB xác nhận revision chưa có; lỗi cleanup không thay thế lỗi gốc của thao tác tạo revision.
        try {
            await this.storage.delete(revisionId);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown error';
            this.logger.warn(
                `Không dọn được object revision ${revisionId}: ${message}`,
            );
        }
    }

    // Chuẩn hóa newline và khoảng trắng để hash/size ổn định, sau đó áp dụng cùng validator cho mọi đường lưu source.
    // Từ chối HTML/script nhúng và nội dung quá lớn trước I/O; nội dung được dùng làm dữ liệu retrieval, không phải mã chạy.
    private validateMarkdown(markdown: string): string {
        const normalized = markdown.replace(/\r\n?/gu, '\n').trim();
        const errors = this.validateMarkdownContent(normalized);
        if (errors.length)
            throw new BadRequestException({
                message: 'Nội dung Markdown không hợp lệ.',
                errors,
            });
        return normalized;
    }

    // Thu thập mọi lỗi độc lập để preview có thể chỉ rõ nhiều vấn đề trong một lần; caller quyết định trả lỗi hay gắn trạng thái.
    private validateMarkdownContent(markdown: string): string[] {
        const errors: string[] = [];
        // Cho phép phát hiện đồng thời nhiều lỗi thay vì dừng ở lỗi đầu tiên, giúp UI hướng dẫn sửa một lượt.
        if (!markdown.trim()) errors.push('Nội dung không được để trống.');
        if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES)
            errors.push('Dung lượng Markdown vượt quá 64 KB.');
        if (/<\s*(?:script|iframe|object|style)\b/iu.test(markdown))
            errors.push('Không hỗ trợ thẻ thực thi hoặc nhúng nội dung.');
        return errors;
    }

    // Chấp nhận null/undefined là không giới hạn; ngày có giá trị phải là ngày lịch ISO hợp lệ, không chỉ khớp regex.
    // So sánh chuỗi chỉ sau khi định dạng đã chuẩn hóa để bảo đảm ngày bắt đầu không nằm sau ngày kết thúc.
    private validateDates(from?: string | null, to?: string | null): void {
        const valid = (value?: string | null) =>
            value == null ||
            (/^\d{4}-\d{2}-\d{2}$/u.test(value) &&
                !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
                new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) ===
                    value);
        if (!valid(from) || !valid(to) || (from && to && from > to))
            throw new BadRequestException('Ngày hiệu lực không hợp lệ.');
    }

    // Đóng gói tra cứu bắt buộc thành lỗi 404 nghiệp vụ; caller không nhận entity null rồi tự phát sinh lỗi hạ tầng.
    private async requireDocument(
        id: string,
    ): Promise<SellerKnowledgeDocumentRecord> {
        const document = await this.repository.findDocument(id);
        if (!document) throw new NotFoundException('Không tìm thấy tài liệu.');
        return document;
    }

    // Đảm bảo revision tồn tại trước storage/index; caller vẫn phải kiểm tra documentId khi thao tác có document cụ thể.
    private async requireRevision(
        id: string,
    ): Promise<SellerKnowledgeRevisionRecord> {
        const revision = await this.repository.findRevision(id);
        if (!revision)
            throw new NotFoundException('Không tìm thấy phiên bản tài liệu.');
        return revision;
    }

    // Tính cosine giữa hai vector cùng model để preview xếp hạng ngữ nghĩa; hàm thuần, không ghi dữ liệu.
    // Vector zero không có hướng ngữ nghĩa nên trả 0 thay vì chia cho 0/NaN làm hỏng thứ tự kết quả.
    private cosine(a: number[], b: number[]): number {
        const dot = a.reduce(
            (sum, value, index) => sum + value * (b[index] ?? 0),
            0,
        );
        const normA = Math.sqrt(
            a.reduce((sum, value) => sum + value * value, 0),
        );
        const normB = Math.sqrt(
            b.reduce((sum, value) => sum + value * value, 0),
        );
        return normA && normB ? dot / (normA * normB) : 0;
    }
}
