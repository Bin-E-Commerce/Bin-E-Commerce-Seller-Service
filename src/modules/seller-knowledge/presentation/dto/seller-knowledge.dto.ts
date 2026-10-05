import {
    IsIn,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength,
} from 'class-validator';

// DTO chỉ nhận metadata và Markdown; không có field source URL, SQL, script hay adapter tùy ý.
export class CreateSellerKnowledgeDocumentDto {
    @IsString() @MinLength(3) @MaxLength(200) title: string;
    @IsString()
    @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    @MaxLength(160)
    slug: string;
    @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/u) domainCode: string;
    @IsOptional() @IsIn(['vi', 'en']) language?: string;
    @IsOptional() @IsString() @MaxLength(10) effectiveFrom?: string | null;
    @IsOptional() @IsString() @MaxLength(10) effectiveTo?: string | null;
    @IsString() @MinLength(20) @MaxLength(65536) markdown: string;
}

// Domain quản trị v1 chỉ có thể là knowledge; live-data/profile phải có adapter code được đăng ký.
export class CreateSellerKnowledgeDomainDto {
    @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/u) code: string;
    @IsString() @MinLength(2) @MaxLength(120) label: string;
    @IsString() @MinLength(20) @MaxLength(2000) description: string;
    @IsOptional() @IsString() @MaxLength(2000) examples?: string;
    @IsIn(['DRAFT', 'ACTIVE']) status: 'DRAFT' | 'ACTIVE';
}

// Lưu revision mới thay vì overwrite source đã publish; document metadata có thể được cập nhật cùng bản thảo.
export class SaveSellerKnowledgeRevisionDto extends CreateSellerKnowledgeDocumentDto {}

// Query thử được giới hạn độ dài để tránh embedding request tốn kém hoặc payload quá lớn.
export class TestSellerKnowledgeQueryDto {
    @IsString() @MinLength(3) @MaxLength(500) question: string;
    @IsOptional() @IsString() @MaxLength(80) domainCode?: string;
}

// Bắt buộc lưu lý do rollback để audit nêu được vì sao source cũ được phát hành lại.
export class RollbackSellerKnowledgeDto {
    @IsString()
    @MinLength(5)
    @MaxLength(500)
    reason: string;
}
