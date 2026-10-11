import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsUUID,
} from 'class-validator';

// Batch chỉ nhận danh sách proposal ID; tenant, owner và quyền luôn lấy từ header do Gateway xác thực.
export class ConfirmSellerCopilotActionsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(50)
    @ArrayUnique()
    @IsUUID('4', { each: true })
    proposalIds!: string[];
}
