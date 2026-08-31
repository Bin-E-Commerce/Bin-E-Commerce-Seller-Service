import { IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

export class PickupAddressDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  contactName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0|\+84)\d{9,10}$/, {
    message: "phone must be a valid Vietnamese phone number",
  })
  phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  wardCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  provinceName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  districtName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  wardName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string;
}
