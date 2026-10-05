// API quản trị Seller Knowledge; controller xác thực quyền nội bộ trước khi gọi use case.
import {
    Body,
    Controller,
    Get,
    Headers,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UnauthorizedException,
    ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Permission } from '@common/auth';
import { SellerKnowledgeService } from '@/modules/seller-knowledge/application/services/seller-knowledge.service';
import {
    CreateSellerKnowledgeDocumentDto,
    CreateSellerKnowledgeDomainDto,
    RollbackSellerKnowledgeDto,
    SaveSellerKnowledgeRevisionDto,
    TestSellerKnowledgeQueryDto,
} from '@/modules/seller-knowledge/presentation/dto/seller-knowledge.dto';

// Admin API là ranh giới HTTP cho Seller Knowledge; controller xác thực service token, actor và permission trước khi gọi use case.
// Controller chỉ map request/response và không chứa truy vấn DB, xử lý file Markdown hay gọi embedding/Qdrant trực tiếp.
@Controller('admin/seller-knowledge')
export class SellerKnowledgeAdminController {
    // Service thực hiện nghiệp vụ; ConfigService chỉ dùng để so token nội bộ do Gateway chuyển tiếp.
    constructor(
        private readonly service: SellerKnowledgeService,
        private readonly config: ConfigService,
    ) {}

    // Đòi quyền read trước khi chuyển filter cho service; quyền này không bao hàm quyền sửa hay publish.
    // Danh sách chỉ trả metadata để tránh tải Markdown từng tài liệu khi người dùng mở kho.
    @Get('documents')
    async listDocuments(
        @Headers() headers: Record<string, string | undefined>,
        @Query() query: { search?: string; domain?: string; status?: string },
    ) {
        this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_READ);
        return this.service.listDocuments(query);
    }

    // Dùng quyền read và luôn yêu cầu include draft để admin có thể cấu hình các nhóm chưa kích hoạt.
    // Việc chỉ đưa ACTIVE domain vào classifier được xử lý ở registry provider, không phải ở endpoint quản trị.
    @Get('domains')
    async listDomains(@Headers() headers: Record<string, string | undefined>) {
        this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_READ);
        return this.service.listDomains(true);
    }

    // Domain-manage là quyền riêng vì tạo nhóm ảnh hưởng cấu hình phân loại dùng chung.
    // Actor đã xác thực được chuyển xuống service để lưu createdBy và audit; controller không tự gán danh tính từ body.
    @Post('domains')
    async createDomain(
        @Headers() headers: Record<string, string | undefined>,
        @Body() dto: CreateSellerKnowledgeDomainDto,
    ) {
        const actorId = this.authorize(
            headers,
            Permission.ADMIN_SELLER_KNOWLEDGE_DOMAIN_MANAGE,
        );
        return this.service.createDomain(dto, actorId);
    }

    // Chỉ chấp nhận hai trạng thái được route hỗ trợ trước khi gọi service; giá trị path param vẫn là input không đáng tin.
    // Service kiểm tra điều kiện có tài liệu published khi bật, còn repository đảm bảo trạng thái và audit cùng transaction.
    @Patch('domains/:code/:status')
    async setDomainStatus(
        @Headers() headers: Record<string, string | undefined>,
        @Param('code') code: string,
        @Param('status') status: 'ACTIVE' | 'ARCHIVED',
    ) {
        const actorId = this.authorize(
            headers,
            Permission.ADMIN_SELLER_KNOWLEDGE_DOMAIN_MANAGE,
        );
        // Whitelist trạng thái tại HTTP boundary để chuỗi tùy ý không thể đi vào update domain.
        if (!['ACTIVE', 'ARCHIVED'].includes(status))
            throw new ForbiddenException(
                'Trạng thái domain không được hỗ trợ.',
            );
        return this.service.setDomainStatus(code, status, actorId);
    }

    // Ghi quyền WRITE trước khi xử lý body; quyền này cho phép tạo nội dung nháp nhưng không xuất bản nó.
    // Use case trả cả document và revision đầu tiên, còn controller chỉ trả kết quả cho frontend.
    @Post('documents')
    async createDocument(
        @Headers() headers: Record<string, string | undefined>,
        @Body() dto: CreateSellerKnowledgeDocumentDto,
    ) {
        return this.service.createDocument(
            dto,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_WRITE),
        );
    }

    // UUID pipe chặn ID sai định dạng ngay ở tầng route; quyền READ cho phép xem metadata/lịch sử chứ không tải mọi source.
    @Get('documents/:id')
    async getDocument(
        @Headers() headers: Record<string, string | undefined>,
        @Param('id', new ParseUUIDPipe()) id: string,
    ) {
        this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_READ);
        return this.service.getDocument(id);
    }

    // Archive giữ source, revision và point Qdrant để còn audit/rollback; endpoint chỉ yêu cầu quyền WRITE và chuyển lệnh.
    @Post('documents/:id/archive')
    async archiveDocument(
        @Headers() headers: Record<string, string | undefined>,
        @Param('id', new ParseUUIDPipe()) id: string,
    ): Promise<void> {
        await this.service.archiveDocument(
            id,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_WRITE),
        );
    }

    // Restore chỉ trả tài liệu khỏi trạng thái archived; domain vẫn có trạng thái riêng và không tự được kích hoạt theo.
    // Quyền WRITE được xác nhận trước khi service tính trạng thái khôi phục từ revision và ngày hết hạn.
    @Post('documents/:id/restore')
    async restoreDocument(
        @Headers() headers: Record<string, string | undefined>,
        @Param('id', new ParseUUIDPipe()) id: string,
    ): Promise<void> {
        await this.service.restoreDocument(
            id,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_WRITE),
        );
    }

    // Mỗi lần sửa tạo revision mới thay vì ghi đè source đã publish; controller xác minh UUID và WRITE rồi chuyển dữ liệu.
    @Post('documents/:id/revisions')
    async saveRevision(
        @Headers() headers: Record<string, string | undefined>,
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() dto: SaveSellerKnowledgeRevisionDto,
    ) {
        return this.service.saveRevision(
            id,
            dto,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_WRITE),
        );
    }

    // Chỉ cần READ để xem nội dung/chunk/validation; service đọc source theo revision ID và không ghi vector live.
    @Get('revisions/:revisionId/preview')
    async preview(
        @Headers() headers: Record<string, string | undefined>,
        @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    ) {
        this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_READ);
        return this.service.preview(revisionId);
    }

    // READ đủ để chạy thử câu hỏi; query chỉ đánh giá vector tạm với chunk revision, không thay đổi trạng thái tài liệu.
    @Post('revisions/:revisionId/test-query')
    async testDraft(
        @Headers() headers: Record<string, string | undefined>,
        @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
        @Body() dto: TestSellerKnowledgeQueryDto,
    ) {
        this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_READ);
        return this.service.testDraft(revisionId, dto.question);
    }

    // PUBLISH tách khỏi WRITE để người có quyền biên tập không mặc nhiên phát hành dữ liệu production.
    // Service chịu trách nhiệm job, validation, embedding, Qdrant và chỉ sau đó mới đổi revision active trong PostgreSQL.
    @Post('revisions/:revisionId/publish')
    async publish(
        @Headers() headers: Record<string, string | undefined>,
        @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
    ) {
        return this.service.publish(
            revisionId,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_PUBLISH),
        );
    }

    // ROLLBACK là quyền riêng vì nó phát hành lại nội dung; target revision và lý do được chuyển nguyên vẹn cho use case.
    // Service tạo revision mới từ source cũ nên endpoint không sửa hoặc xóa lịch sử đã ghi.
    @Post('documents/:id/rollback/:revisionId')
    async rollback(
        @Headers() headers: Record<string, string | undefined>,
        @Param('id', new ParseUUIDPipe()) id: string,
        @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
        @Body() dto: RollbackSellerKnowledgeDto,
    ) {
        return this.service.rollback(
            id,
            revisionId,
            this.authorize(headers, Permission.ADMIN_SELLER_KNOWLEDGE_ROLLBACK),
            dto.reason,
        );
    }

    // Xác thực theo thứ tự: shared token chứng minh request đi từ Gateway/service tin cậy, actor xác định người thao tác,
    // rồi permission xác định hành động cụ thể; thiếu bất kỳ lớp nào thì từ chối trước khi chạm use case.
    // Các header user/permission chỉ được tin sau khi shared token hợp lệ; method trả actorId đã trim để ghi audit.
    private authorize(
        headers: Record<string, string | undefined>,
        permission: Permission,
    ): string {
        // Nếu secret chưa cấu hình thì fail closed; token rỗng không được coi là một lời xác thực hợp lệ.
        const expected = this.config.get<string>('INTERNAL_SERVICE_TOKEN', '');
        if (!expected || headers['x-internal-service-token'] !== expected)
            throw new UnauthorizedException(
                'Internal service authentication required.',
            );
        // Actor lấy từ header do Gateway đã xác minh; trim để không ghi nhận ID rỗng giả do khoảng trắng.
        const actorId = headers['x-user-id']?.trim();
        if (!actorId)
            throw new UnauthorizedException(
                'Đăng nhập quản trị trước khi tiếp tục.',
            );
        // Gateway gửi danh sách comma-separated; chuẩn hóa từng mục để so khớp chính xác permission enum.
        const permissions = (headers['x-user-permissions'] ?? '')
            .split(',')
            .map((item) => item.trim());
        // Chỉ kiểm tra quyền yêu cầu cụ thể, không suy diễn quyền cao hơn từ quyền read/write khác.
        if (!permissions.includes(permission))
            throw new ForbiddenException(
                'Bạn chưa được cấp quyền thực hiện thao tác này.',
            );
        return actorId;
    }
}
