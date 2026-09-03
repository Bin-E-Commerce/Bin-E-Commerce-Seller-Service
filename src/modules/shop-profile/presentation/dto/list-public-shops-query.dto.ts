// DTO này chuẩn hóa bộ lọc danh sách shop public và giới hạn phân trang cho customer.
// DTO không chứa thông tin riêng tư; service chỉ dùng các field này để đọc shop đang hoạt động.

import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListPublicShopsQueryDto {
  @IsOptional()
  @IsString()
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
