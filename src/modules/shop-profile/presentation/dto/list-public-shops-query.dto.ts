// DTO này chuẩn hóa bộ lọc danh sách shop public và giới hạn phân trang cho customer.
// DTO không chứa thông tin riêng tư; service chỉ dùng các field này để đọc shop đang hoạt động.

import { Type } from 'class-transformer';
import {
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class ListPublicShopsQueryDto {
    // Giới hạn query để chi phí ILIKE không tăng theo chuỗi đầu vào tùy ý.
    @IsOptional()
    @IsString()
    @MaxLength(120)
    search?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    pageSize = 12;
}
