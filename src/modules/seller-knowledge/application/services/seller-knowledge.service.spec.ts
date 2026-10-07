// Unit test use case Seller Knowledge qua repository port; không kết nối PostgreSQL hay dịch vụ ngoài.
import { ServiceUnavailableException } from '@nestjs/common';
import {
    SellerKnowledgeDomainStatus,
    SellerKnowledgePublishJobStatus,
} from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';
import type { SellerKnowledgeRepositoryPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-repository.port';
import type { SellerKnowledgeDomainRecord } from '@/modules/seller-knowledge/application/types/seller-knowledge.types';
import { SellerKnowledgeService } from '@/modules/seller-knowledge/application/services/seller-knowledge.service';
import type { SellerKnowledgeStorageClient } from '@/modules/seller-knowledge/application/clients/seller-knowledge-storage.client';
import type {
    SellerKnowledgeEmbeddingPort,
    SellerKnowledgeVectorIndexPort,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';

// Unit test ranh giới tạo domain và publish để bảo đảm quyền cấu hình không biến thành adapter thực thi.
describe('SellerKnowledgeService', () => {
    let repository: jest.Mocked<SellerKnowledgeRepositoryPort>;
    let storage: jest.Mocked<SellerKnowledgeStorageClient>;
    let embedding: jest.Mocked<SellerKnowledgeEmbeddingPort>;
    let vectorIndex: jest.Mocked<SellerKnowledgeVectorIndexPort>;
    let service: SellerKnowledgeService;

    // Tạo dependency giả để unit test không truy cập PostgreSQL, S3, OpenAI hoặc Qdrant thật.
    beforeEach(() => {
        repository = {
            listRetrievalScopes: jest.fn(),
            listDomains: jest.fn(),
            findDomain: jest.fn(),
            saveDomain: jest.fn(),
            setDomainStatus: jest.fn(),
            listDocuments: jest.fn(),
            hasPublishedDocumentsForDomain: jest.fn(),
            markExpiredDocuments: jest.fn(),
            findDocument: jest.fn(),
            findDocumentBySlug: jest.fn(),
            updateDocument: jest.fn(),
            restoreDocument: jest.fn(),
            listRevisions: jest.fn(),
            findRevision: jest.fn(),
            updateRevision: jest.fn(),
            createDocument: jest.fn(),
            createRevision: jest.fn(),
            saveJob: jest.fn(),
            activateRevision: jest.fn(),
            failJob: jest.fn(),
            addAudit: jest.fn(),
        };
        storage = {
            store: jest.fn(),
            read: jest.fn(),
            delete: jest.fn(),
        } as unknown as jest.Mocked<SellerKnowledgeStorageClient>;
        embedding = { embed: jest.fn() };
        vectorIndex = { publishRevision: jest.fn() };
        service = new SellerKnowledgeService(
            repository,
            storage,
            embedding,
            vectorIndex,
        );
    });

    // Domain admin bắt đầu ở draft và chỉ có thể kích hoạt sau khi có tài liệu đã xuất bản.
    it('registers an admin domain only as knowledge', async () => {
        repository.findDomain.mockResolvedValue(null);
        repository.saveDomain.mockImplementation(
            async (domain) => domain as never,
        );

        await service.createDomain(
            {
                code: 'returns-guide',
                label: 'Hướng dẫn trả hàng',
                description: 'Quy trình xử lý các yêu cầu trả hàng.',
                status: 'DRAFT',
            },
            'admin-id',
        );

        expect(repository.saveDomain).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'knowledge',
                implementationKey: null,
                status: SellerKnowledgeDomainStatus.DRAFT,
            }),
        );
    });

    // API admin phân biệt nhóm seed với nhóm do người dùng tạo theo actor nguồn, không dựa vào mã domain ở frontend.
    it('marks seeded domains as system and newly created domains as admin', async () => {
        // Arrange
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        repository.listDomains.mockResolvedValue([
            {
                code: 'shipping',
                label: 'Giao nhận',
                description: 'Nhóm hệ thống.',
                examples: [],
                kind: 'knowledge',
                implementationKey: null,
                status: SellerKnowledgeDomainStatus.ACTIVE,
                createdBy: '00000000-0000-0000-0000-000000000001',
                updatedBy: '00000000-0000-0000-0000-000000000001',
                createdAt,
                updatedAt: createdAt,
            },
            {
                code: 'returns-guide',
                label: 'Đổi trả',
                description: 'Nhóm do admin tạo.',
                examples: ['Khách muốn đổi hàng thì sao?'],
                kind: 'knowledge',
                implementationKey: null,
                status: SellerKnowledgeDomainStatus.DRAFT,
                createdBy: 'admin-id',
                updatedBy: 'admin-id',
                createdAt,
                updatedAt: createdAt,
            },
        ] as SellerKnowledgeDomainRecord[]);

        // Act
        const result = await service.listDomains();

        // Assert
        expect(result.map(({ code, source }) => ({ code, source }))).toEqual([
            { code: 'shipping', source: 'SYSTEM' },
            { code: 'returns-guide', source: 'ADMIN' },
        ]);
        expect(result[0]).toMatchObject({
            label: 'Giao nhận',
            status: SellerKnowledgeDomainStatus.ACTIVE,
            createdAt,
        });
        expect(repository.listDomains).toHaveBeenCalledWith(true);
        expect(repository.listDomains).toHaveBeenCalledTimes(1);
    });

    // Không để planner nhận domain rỗng chỉ vì admin chọn trạng thái ACTIVE lúc tạo.
    it('rejects creating a domain as active before it has published evidence', async () => {
        // Arrange
        repository.findDomain.mockResolvedValue(null);

        // Act & Assert
        await expect(
            service.createDomain(
                {
                    code: 'new-policy',
                    label: 'Chính sách mới',
                    description: 'Nội dung chính sách dành cho người bán.',
                    status: 'ACTIVE',
                },
                'admin-id',
            ),
        ).rejects.toThrow('Domain mới cần được tạo ở trạng thái nháp');
        expect(repository.saveDomain).not.toHaveBeenCalled();
    });

    // Domain nháp chỉ mở cho planner sau khi có tài liệu phát hành làm căn cứ.
    it('keeps a domain inactive when it has no published documents', async () => {
        // Arrange
        repository.findDomain.mockResolvedValue({
            code: 'new-policy',
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.DRAFT,
        } as never);
        repository.hasPublishedDocumentsForDomain.mockResolvedValue(false);

        // Act & Assert
        await expect(
            service.setDomainStatus('new-policy', 'ACTIVE', 'admin-id'),
        ).rejects.toThrow('ít nhất một tài liệu đã xuất bản');
        expect(repository.saveDomain).not.toHaveBeenCalled();
        expect(repository.setDomainStatus).not.toHaveBeenCalled();
    });

    // Tạo tài liệu nháp trong domain archived để admin có thể chuẩn bị nội dung rồi xuất bản trước khi kích hoạt lại.
    it('creates a draft document for an archived knowledge domain', async () => {
        // Arrange
        const domainCode = 'shipping';
        const createdDocument = {
            id: 'document-id',
            domainCode,
            status: 'DRAFT',
        };
        const createdRevision = {
            id: 'revision-id',
            documentId: createdDocument.id,
            status: 'DRAFT',
        };
        repository.findDomain.mockResolvedValue({
            code: domainCode,
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ARCHIVED,
        } as never);
        repository.findDocumentBySlug.mockResolvedValue(null);
        storage.store.mockResolvedValue(
            'seller-knowledge/revisions/revision-id.md',
        );
        repository.createDocument.mockResolvedValue({
            document: createdDocument,
            revision: createdRevision,
        } as never);

        // Act
        const result = await service.createDocument(
            {
                title: 'Chính sách giao hàng',
                slug: 'chinh-sach-giao-hang',
                domainCode,
                language: 'vi',
                markdown: '# Giao hàng\n\nNội dung chính sách vận chuyển.',
            },
            'admin-id',
        );

        // Assert
        expect(result).toEqual({
            document: createdDocument,
            revision: createdRevision,
        });
        expect(repository.createDocument).toHaveBeenCalledWith(
            expect.objectContaining({ domainCode, status: 'DRAFT' }),
            expect.objectContaining({
                documentMetadata: expect.objectContaining({ domainCode }),
                status: 'DRAFT',
            }),
        );
    });

    // Nhóm ACTIVE chưa có tài liệu vẫn được ngừng sử dụng; audit và cập nhật được giao cùng một lệnh repository.
    it('archives an active domain without requiring published documents', async () => {
        // Arrange
        const domain = {
            code: 'seller-center-troubleshooting',
            label: 'Seller Center',
            description: 'Hướng dẫn vận hành Seller Center.',
            examples: [],
            kind: 'knowledge' as const,
            implementationKey: null,
            status: SellerKnowledgeDomainStatus.ACTIVE,
            createdBy: 'admin-id',
            updatedBy: 'admin-id',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        repository.findDomain.mockResolvedValue(domain);
        repository.setDomainStatus.mockResolvedValue({
            ...domain,
            status: SellerKnowledgeDomainStatus.ARCHIVED,
        });

        // Act
        const result = await service.setDomainStatus(
            domain.code,
            'ARCHIVED',
            'admin-id',
        );

        // Assert
        expect(result).toMatchObject({
            code: domain.code,
            status: SellerKnowledgeDomainStatus.ARCHIVED,
            source: 'ADMIN',
        });
        expect(
            repository.hasPublishedDocumentsForDomain,
        ).not.toHaveBeenCalled();
        expect(repository.setDomainStatus).toHaveBeenCalledWith(
            domain.code,
            'ARCHIVED',
            'admin-id',
        );
        expect(repository.addAudit).not.toHaveBeenCalled();
    });

    // Lỗi thiếu embedding provider phải đánh dấu job thất bại và không chuyển revision active.
    it('keeps the current published revision when the embedding provider is unavailable', async () => {
        repository.findRevision.mockResolvedValue({
            id: 'revision-id',
            documentId: 'document-id',
            revisionNumber: 2,
            status: 'DRAFT',
            documentMetadata: {
                title: 'Vận chuyển',
                slug: 'van-chuyen',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
            },
        } as never);
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            domainCode: 'shipping',
            title: 'Vận chuyển',
            language: 'vi',
            slug: 'van-chuyen',
            effectiveFrom: null,
            effectiveTo: null,
        } as never);
        repository.findDomain.mockResolvedValue({
            status: SellerKnowledgeDomainStatus.ACTIVE,
            kind: 'knowledge',
        } as never);
        storage.read.mockResolvedValue(
            '# Hướng dẫn\n\nNội dung đủ dài để tạo chunk và chạy thử publish.',
        );
        repository.saveJob.mockResolvedValue({
            id: 'job-id',
            status: SellerKnowledgePublishJobStatus.RUNNING,
        } as never);
        embedding.embed.mockRejectedValue(
            new ServiceUnavailableException(
                'Embedding provider chưa được cấu hình.',
            ),
        );

        await expect(
            service.publish('revision-id', 'admin-id'),
        ).rejects.toThrow(
            'Tạo vector ngữ nghĩa chưa hoàn tất. Bản đang sử dụng vẫn được giữ nguyên; vui lòng thử lại sau.',
        );

        expect(repository.failJob).toHaveBeenCalledWith(
            'job-id',
            '[Tạo vector ngữ nghĩa] Embedding provider chưa được cấu hình.',
        );
        expect(repository.activateRevision).not.toHaveBeenCalled();
    });

    // Không được kích hoạt archived document dù revision còn nội dung hợp lệ.
    it('rejects publishing a document that was archived', async () => {
        // Arrange
        repository.findRevision.mockResolvedValue({
            id: 'revision-id',
            documentId: 'document-id',
            revisionNumber: 2,
            status: 'DRAFT',
            documentMetadata: {
                title: 'Vận chuyển',
                slug: 'van-chuyen',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
            },
        } as never);
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            status: 'ARCHIVED',
        } as never);
        repository.findDomain.mockResolvedValue({
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ARCHIVED,
        } as never);

        // Act & Assert
        await expect(
            service.publish('revision-id', 'admin-id'),
        ).rejects.toThrow('Không thể xuất bản tài liệu đã lưu trữ.');
        expect(repository.saveJob).not.toHaveBeenCalled();
        expect(embedding.embed).not.toHaveBeenCalled();
    });

    // Ngày kết thúc đã qua không được đưa thành bằng chứng mới trong Qdrant.
    it('rejects publishing a revision whose effective end date has passed', async () => {
        // Arrange
        repository.findRevision.mockResolvedValue({
            id: 'revision-id',
            documentId: 'document-id',
            revisionNumber: 2,
            status: 'DRAFT',
            documentMetadata: {
                title: 'Vận chuyển',
                slug: 'van-chuyen',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: '2000-01-01',
            },
        } as never);
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            status: 'PUBLISHED',
        } as never);
        repository.findDomain.mockResolvedValue({
            status: SellerKnowledgeDomainStatus.ACTIVE,
            kind: 'knowledge',
        } as never);

        // Act & Assert
        await expect(
            service.publish('revision-id', 'admin-id'),
        ).rejects.toThrow('Ngày hết hiệu lực đã qua');
        expect(repository.saveJob).not.toHaveBeenCalled();
        expect(embedding.embed).not.toHaveBeenCalled();
    });

    // Draft mới trong domain archived giữ metadata ở revision; nội dung không làm domain tự active.
    it('stores a revision for an archived domain without activating that domain', async () => {
        // Arrange
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
        } as never);
        repository.findDomain.mockResolvedValue({
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ARCHIVED,
        } as never);
        repository.findDocumentBySlug.mockResolvedValue(null);
        storage.store.mockResolvedValue(
            'seller-knowledge/revisions/revision-id.md',
        );
        repository.createRevision.mockImplementation(
            async (revision) => revision as never,
        );

        // Act
        await service.saveRevision(
            'document-id',
            {
                title: 'Chính sách mới',
                slug: 'chinh-sach-moi',
                domainCode: 'shipping',
                language: 'vi',
                markdown: '# Chính sách\n\nNội dung dài hơn hai mươi ký tự.',
            },
            'admin-id',
        );

        // Assert
        expect(repository.createRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                documentMetadata: expect.objectContaining({
                    title: 'Chính sách mới',
                    slug: 'chinh-sach-moi',
                }),
            }),
            'admin-id',
        );
        expect(repository.updateDocument).not.toHaveBeenCalled();
    });

    // Nếu ghi transaction revision thất bại sau upload, source tạm phải được dọn để không tích lũy object mồ côi.
    it('deletes the uploaded source when saving revision metadata fails', async () => {
        // Arrange
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            status: 'PUBLISHED',
        } as never);
        repository.findDomain.mockResolvedValue({
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ACTIVE,
        } as never);
        repository.findDocumentBySlug.mockResolvedValue(null);
        storage.store.mockResolvedValue('seller-knowledge/revisions/temp.md');
        storage.delete.mockResolvedValue(undefined);
        repository.createRevision.mockRejectedValue(
            new Error('database transaction failed'),
        );

        // Act & Assert
        await expect(
            service.saveRevision(
                'document-id',
                {
                    title: 'Chính sách mới',
                    slug: 'chinh-sach-moi',
                    domainCode: 'shipping',
                    language: 'vi',
                    markdown: '# Nội dung\n\nĐủ dài để lưu revision mới.',
                },
                'admin-id',
            ),
        ).rejects.toThrow('database transaction failed');
        expect(storage.delete).toHaveBeenCalledWith(expect.any(String));
        expect(repository.addAudit).not.toHaveBeenCalled();
    });

    // Nếu kết nối DB lỗi sau commit, revision đã có thể tồn tại; khi đó giữ object để tránh tạo bản ghi mất nguồn.
    it('keeps the source when a failed save may already have committed', async () => {
        // Arrange
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            status: 'PUBLISHED',
        } as never);
        repository.findDomain.mockResolvedValue({
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ACTIVE,
        } as never);
        repository.findDocumentBySlug.mockResolvedValue(null);
        storage.store.mockResolvedValue('seller-knowledge/revisions/temp.md');
        repository.createRevision.mockRejectedValue(
            new Error('connection lost while confirming commit'),
        );
        repository.findRevision.mockImplementation(
            async (id) => ({ id }) as never,
        );

        // Act & Assert
        await expect(
            service.saveRevision(
                'document-id',
                {
                    title: 'Chính sách mới',
                    slug: 'chinh-sach-moi',
                    domainCode: 'shipping',
                    language: 'vi',
                    markdown: '# Nội dung\n\nĐủ dài để lưu revision mới.',
                },
                'admin-id',
            ),
        ).rejects.toThrow('connection lost while confirming commit');
        expect(repository.findRevision).toHaveBeenCalledWith(
            expect.any(String),
        );
        expect(storage.delete).not.toHaveBeenCalled();
    });

    // Publish vẫn dùng snapshot revision; domain archived không được planner chọn dù vector đã sẵn sàng.
    it('publishes revision metadata while the knowledge domain remains archived', async () => {
        // Arrange
        const metadata = {
            title: 'Chính sách giao hàng mới',
            slug: 'giao-hang-moi',
            domainCode: 'shipping',
            language: 'vi',
            effectiveFrom: null,
            effectiveTo: null,
        };
        repository.findRevision.mockResolvedValue({
            id: 'revision-id',
            documentId: 'document-id',
            revisionNumber: 2,
            status: 'DRAFT',
            documentMetadata: metadata,
        } as never);
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            slug: 'giao-hang-cu',
            title: 'Chính sách giao hàng cũ',
            domainCode: 'shipping',
            language: 'vi',
            status: 'PUBLISHED',
            effectiveFrom: null,
            effectiveTo: null,
        } as never);
        repository.findDomain.mockResolvedValue({
            kind: 'knowledge',
            status: SellerKnowledgeDomainStatus.ARCHIVED,
        } as never);
        storage.read.mockResolvedValue(
            '## Giao hàng\n\nNội dung chính sách được lưu trong revision mới.',
        );
        repository.saveJob.mockResolvedValue({
            id: 'job-id',
            revisionId: 'revision-id',
            status: SellerKnowledgePublishJobStatus.RUNNING,
        } as never);
        embedding.embed.mockResolvedValue([[0.1, 0.2]]);
        repository.activateRevision.mockResolvedValue(true);

        // Act
        const result = await service.publish('revision-id', 'admin-id');

        // Assert
        expect(result).toMatchObject({ id: 'job-id', status: 'SUCCEEDED' });
        expect(vectorIndex.publishRevision).toHaveBeenCalledWith(
            expect.objectContaining({
                document: expect.objectContaining(metadata),
            }),
        );
        expect(repository.activateRevision).toHaveBeenCalledWith(
            'document-id',
            'revision-id',
            'job-id',
            'admin-id',
            metadata,
        );
    });

    // Nếu trạng thái document đổi trong khi Qdrant đang lập chỉ mục, pointer cũ vẫn được giữ nguyên.
    it('does not activate a revision when the repository detects a lifecycle race', async () => {
        // Arrange
        repository.findRevision.mockResolvedValue({
            id: 'revision-id',
            documentId: 'document-id',
            revisionNumber: 2,
            status: 'DRAFT',
            documentMetadata: {
                title: 'Vận chuyển',
                slug: 'van-chuyen',
                domainCode: 'shipping',
                language: 'vi',
                effectiveFrom: null,
                effectiveTo: null,
            },
        } as never);
        repository.findDocument.mockResolvedValue({
            id: 'document-id',
            status: 'PUBLISHED',
        } as never);
        repository.findDomain.mockResolvedValue({
            status: SellerKnowledgeDomainStatus.DRAFT,
            kind: 'knowledge',
        } as never);
        storage.read.mockResolvedValue(
            '## Quy trình\n\nNội dung đủ dài để lập chỉ mục.',
        );
        repository.saveJob.mockResolvedValue({
            id: 'job-id',
            status: SellerKnowledgePublishJobStatus.RUNNING,
        } as never);
        embedding.embed.mockResolvedValue([[0.1]]);
        repository.activateRevision.mockResolvedValue(false);

        // Act & Assert
        await expect(
            service.publish('revision-id', 'admin-id'),
        ).rejects.toThrow('Tài liệu đã thay đổi trạng thái');
        expect(repository.failJob).toHaveBeenCalledWith(
            'job-id',
            'Revision hoặc tài liệu đã đổi trạng thái trong lúc xuất bản.',
        );
    });
});
