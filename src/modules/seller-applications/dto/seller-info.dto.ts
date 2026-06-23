import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { SellerProfileType } from "../enums/seller-profile-type.enum";

export class SellerInfoDto {
  @IsOptional()
  @IsEnum(SellerProfileType)
  profileType?: SellerProfileType;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{9}|\d{12})$/, {
    message: "citizenId must contain 9 or 12 digits",
  })
  citizenId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{10}|\d{13})$/, {
    message: "taxCode must contain 10 or 13 digits",
  })
  taxCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  representativeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  representativeRole?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0|\+84)\d{9,10}$/, {
    message: "phone must be a valid Vietnamese phone number",
  })
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  documents?: Record<string, unknown>;
}
