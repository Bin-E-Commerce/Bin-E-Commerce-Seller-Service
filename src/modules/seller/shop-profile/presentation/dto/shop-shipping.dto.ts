// DTO cho địa chỉ lấy hàng và thời gian chuẩn bị đơn của Seller.

import { IsBoolean, IsInt, IsOptional, IsPhoneNumber, IsString, IsUUID, Max, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";

export class SavePickupAddressDto {
  @IsString()
  @MinLength(2)
  contactName!: string;

  @IsPhoneNumber("VN")
  phone!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  provinceId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId!: number;

  @IsString()
  @MinLength(1)
  wardCode!: string;

  @IsString()
  @MinLength(1)
  provinceName!: string;

  @IsString()
  @MinLength(1)
  districtName!: string;

  @IsString()
  @MinLength(1)
  wardName!: string;

  @IsString()
  @MinLength(5)
  addressLine!: string;

}

export class UpdateShopShippingSettingsDto {
  @IsOptional()
  @IsUUID()
  defaultPickupAddressId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  preparationTimeHours?: number;

  @IsOptional()
  @IsString()
  pickupWindowStart?: string;

  @IsOptional()
  @IsString()
  pickupWindowEnd?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
