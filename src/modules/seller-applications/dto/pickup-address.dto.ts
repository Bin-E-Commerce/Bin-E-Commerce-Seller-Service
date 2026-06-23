import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from "class-validator";

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
  @IsUUID()
  provinceId?: string;

  @IsOptional()
  @IsUUID()
  wardId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  addressLine?: string;
}
