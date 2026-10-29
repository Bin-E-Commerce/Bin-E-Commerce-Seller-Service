// Query thống kê chỉ nhận ngày YYYY-MM-DD; seller-service tự áp dụng giờ Việt Nam khi lọc và gom nhóm.
import { IsDateString, Matches } from 'class-validator';

export class SellerApplicationActivityQueryDto {
    @IsDateString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    from!: string;

    @IsDateString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    to!: string;
}
