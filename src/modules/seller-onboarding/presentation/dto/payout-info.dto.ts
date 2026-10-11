// DTO thanh toán; xác thực tên chủ tài khoản theo loại cá nhân/doanh nghiệp.
import {
    IsEnum,
    IsOptional,
    IsString,
    Length,
    Matches,
    MaxLength,
    Validate,
    ValidatorConstraint,
} from 'class-validator';
import type {
    ValidationArguments,
    ValidatorConstraintInterface,
} from 'class-validator';
import { PayoutAccountType } from '@/database/shared/enums/payout-account-type.enum';

const PERSON_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u;

// Tên cá nhân phải là tên người; tên pháp nhân vẫn có thể chứa chữ số.
@ValidatorConstraint({ name: 'personalAccountHolderName', async: false })
class PersonalAccountHolderNameConstraint
    implements ValidatorConstraintInterface
{
    // Đọc accountType cùng request để không áp quy tắc họ tên cá nhân lên công ty.
    validate(value: unknown, args: ValidationArguments): boolean {
        const accountType = (args.object as PayoutInfoDto).accountType;
        if (accountType === PayoutAccountType.BUSINESS) return true;
        return typeof value === 'string' && PERSON_NAME_PATTERN.test(value);
    }

    // Gắn lỗi lên accountHolderName để FE chỉ đúng ô cần sửa.
    defaultMessage(): string {
        return 'Tên chủ tài khoản cá nhân không được chứa chữ số.';
    }
}

// Giữ số tài khoản dạng chuỗi; không ép sang number để bảo toàn số 0 đầu.
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
        message: 'accountNumber must contain 6 to 30 digits',
    })
    accountNumber?: string;

    @IsOptional()
    @IsString()
    @Length(2, 180)
    @Validate(PersonalAccountHolderNameConstraint)
    accountHolderName?: string;

    @IsOptional()
    @IsEnum(PayoutAccountType)
    accountType?: PayoutAccountType;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    branch?: string;
}
