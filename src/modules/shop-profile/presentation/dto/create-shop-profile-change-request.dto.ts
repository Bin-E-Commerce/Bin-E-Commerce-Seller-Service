import { Type } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { PayoutAccountType } from "../../../../database/shared/enums/payout-account-type.enum";

export class ShopTaxChangeDto {
  @IsOptional()
  @IsString()
  @Length(2, 180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{10}|\d{13})$/, {
    message: "Mã số thuế cần gồm 10 hoặc 13 số",
  })
  taxCode?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  invoiceEmail?: string;
}

export class ShopPayoutChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6,30}$/, {
    message: "Số tài khoản cần gồm 6 đến 30 số",
  })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  accountHolderName?: string;

  @IsOptional()
  @IsEnum(PayoutAccountType)
  accountType?: PayoutAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  branch?: string;
}

export class ShopIdentityChangeDto {
  @IsOptional()
  @IsString()
  @Length(2, 180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(\d{9}|\d{12})$/, {
    message: "Số CCCD cần gồm 9 hoặc 12 số",
  })
  citizenId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  representativeName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  representativeRole?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0|\+84)\d{9,10}$/, {
    message: "Số điện thoại liên hệ không hợp lệ",
  })
  contactPhone?: string;

  @IsOptional()
  @IsObject()
  documents?: Record<string, unknown>;
}

export class CreateShopProfileChangeRequestDto {
  // Lý do là dữ liệu nghiệp vụ bắt buộc để admin hiểu thay đổi trước khi kiểm tra chứng từ.
  @IsString()
  @Length(10, 500)
  requestNote: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShopTaxChangeDto)
  tax?: ShopTaxChangeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShopPayoutChangeDto)
  payout?: ShopPayoutChangeDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ShopIdentityChangeDto)
  identity?: ShopIdentityChangeDto;
}
