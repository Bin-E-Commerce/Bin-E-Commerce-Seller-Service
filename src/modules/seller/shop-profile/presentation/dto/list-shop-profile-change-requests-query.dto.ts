import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { ShopProfileChangeRequestStatus } from "../../../../../database/enums/shop-profile-change-request-status.enum";

export class ListShopProfileChangeRequestsQueryDto {
  @IsOptional()
  @IsEnum(ShopProfileChangeRequestStatus)
  status?: ShopProfileChangeRequestStatus;

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
  pageSize = 20;
}
