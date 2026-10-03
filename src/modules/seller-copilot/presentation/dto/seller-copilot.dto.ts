// DTO này chỉ validate input transport; owner/shop scope luôn lấy từ trusted header do API Gateway inject.
// Không thêm shopId hoặc credential vào request để tránh client mở rộng tenant boundary.
import {
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    IsBoolean,
    MaxLength,
    MinLength,
} from 'class-validator';
import type { SellerCopilotRange } from '@/modules/seller-copilot/application/shared/types/seller-copilot.types';
import { SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH } from '@/modules/seller-copilot/application/conversation/utils/conversation-title.util';

// DTO giới hạn dữ liệu từ browser; shop scope luôn được resolve từ x-user-id tại Seller Service.
// Payload chat chỉ nhận message/range/conversationId; scope shop luôn được resolve từ identity trusted.
export class SellerCopilotChatDto {
    @IsOptional()
    @IsUUID()
    conversationId?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(2000)
    message!: string;

    @IsOptional()
    @IsIn(['7d', '30d', '90d'])
    range?: SellerCopilotRange;

    @IsOptional()
    @IsUUID()
    productId?: string;
}

// Payload feedback giới hạn rating và reason để telemetry không trở thành command nghiệp vụ.
export class SellerCopilotFeedbackDto {
    @IsUUID()
    messageId!: string;

    // Chỉ nhận 'up' hoặc 'down'; ownership và conversation scope được xác minh ở application service.
    // Up là positive feedback, down là negative feedback; reason là optional string để seller giải thích lý do.
    @IsIn(['up', 'down'])
    rating!: 'up' | 'down';

    @IsOptional()
    @IsString()
    @MaxLength(300)
    reason?: string;
}

// Payload pin/unpin chỉ nhận boolean; ownership và conversation scope luôn được xác thực ở application service.
export class SellerCopilotPinConversationDto {
    @IsBoolean()
    isPinned!: boolean;
}

// Payload đổi title chỉ nhận chuỗi ngắn; ownership và conversation scope được kiểm tra ở application service.
export class SellerCopilotRenameConversationDto {
    @IsString()
    @MinLength(1)
    @MaxLength(SELLER_COPILOT_CONVERSATION_TITLE_MAX_LENGTH)
    title!: string;
}
