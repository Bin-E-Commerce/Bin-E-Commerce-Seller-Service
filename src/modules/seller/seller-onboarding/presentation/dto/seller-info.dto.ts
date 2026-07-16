import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";

export class SellerInfoDto {
  @IsOptional()
  @IsEnum(SellerProfileType)
  profileType?: SellerProfileType;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  legalName?: string;

  // Draft chỉ validate CCCD khi FE đang gửi hồ sơ cá nhân và có giá trị; tính bắt buộc được kiểm tra lúc submit.
  @ValidateIf(
    (dto: SellerInfoDto) =>
      dto.profileType === SellerProfileType.INDIVIDUAL &&
      dto.citizenId !== undefined,
  )
  @IsString()
  @Matches(/^(\d{9}|\d{12})$/, {
    message: "Số CCCD cần gồm 9 hoặc 12 số",
  })
  citizenId?: string;

  // Draft chỉ validate mã số thuế khi FE đang gửi hồ sơ doanh nghiệp và có giá trị; submit mới bắt buộc field này.
  @ValidateIf(
    (dto: SellerInfoDto) =>
      dto.profileType === SellerProfileType.BUSINESS &&
      dto.taxCode !== undefined,
  )
  @IsString()
  @Matches(/^(\d{10}|\d{13})$/, {
    message: "Mã số thuế cần gồm 10 hoặc 13 số",
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

  // Shape tài liệu còn linh hoạt theo profileType; validator application sẽ kiểm tra đúng key/url bắt buộc khi submit.
  @IsOptional()
  documents?: Record<string, unknown>;
}
