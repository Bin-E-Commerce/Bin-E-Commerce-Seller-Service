// Query dashboard chỉ cho phép ba khoảng thời gian đã được thiết kế và giới hạn.

import { IsIn, IsOptional } from 'class-validator';

export class SellerDashboardQueryDto {
    @IsOptional()
    @IsIn(['7d', '30d', '90d'])
    range?: '7d' | '30d' | '90d';
}
