import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

const BUSINESS_MODELS = ["retail", "brand", "distributor"] as const;

export class ShopInfoDto {
  @IsOptional()
  @IsString()
  @Length(3, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 140)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "shop slug must be lowercase kebab-case",
  })
  slug?: string;

  @IsOptional()
  @IsUUID()
  mainCategoryId?: string;

  @IsOptional()
  @IsIn(BUSINESS_MODELS)
  businessModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  logoUrl?: string;
}
