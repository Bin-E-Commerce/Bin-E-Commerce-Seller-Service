import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";

export class PayoutInfoDto {
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
    message: "accountNumber must contain 6 to 30 digits",
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
