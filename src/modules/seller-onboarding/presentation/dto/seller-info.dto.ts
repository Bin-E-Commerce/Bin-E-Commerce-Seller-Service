// DTO pháp lý người bán; giữ mã định danh dạng chuỗi để bảo toàn số 0 đầu.
import {
    IsEmail,
    IsEnum,
    IsOptional,
    IsString,
    Length,
    Matches,
    MaxLength,
    Validate,
    ValidatorConstraint,
    ValidateIf,
} from 'class-validator';
import type {
    ValidationArguments,
    ValidatorConstraintInterface,
} from 'class-validator';
import { SellerProfileType } from '@/database/shared/enums/seller-profile-type.enum';

const PERSON_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u;

// Chỉ áp quy tắc tên người cho cá nhân; tên pháp nhân có thể chứa chữ số hợp lệ.
@ValidatorConstraint({ name: 'individualLegalName', async: false })
class IndividualLegalNameConstraint implements ValidatorConstraintInterface {
// Tên cá nhân chỉ nhận chữ và dấu phân cách thông dụng; tên pháp nhân tự do hơn.
    validate(value: unknown, args: ValidationArguments): boolean {
        const profileType = (args.object as SellerInfoDto).profileType;
        if (profileType === SellerProfileType.BUSINESS) return true;
        return typeof value === 'string' && PERSON_NAME_PATTERN.test(value);
    }

    // Trả thông báo gắn với field legalName để FE hiển thị đúng vị trí.
    defaultMessage(): string {
        return 'Họ tên cá nhân không được chứa chữ số.';
    }
}

// Xác thực danh tính, liên hệ và giấy tờ tương ứng với loại hồ sơ đã chọn.
export class SellerInfoDto {
    @IsOptional()
    @IsEnum(SellerProfileType)
    profileType?: SellerProfileType;

    @IsOptional()
    @IsString()
    @Length(2, 180)
    @Validate(IndividualLegalNameConstraint)
    legalName?: string;

    // Draft chỉ validate CCCD khi FE đang gửi hồ sơ cá nhân và có giá trị; tính bắt buộc được kiểm tra lúc submit.
    @ValidateIf(
        (dto: SellerInfoDto) =>
            dto.profileType === SellerProfileType.INDIVIDUAL &&
            dto.citizenId !== undefined,
    )
    @IsString()
    @Matches(/^(\d{9}|\d{12})$/, {
        message: 'Số CCCD cần gồm 9 hoặc 12 số',
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
        message: 'Mã số thuế cần gồm 10 hoặc 13 số',
    })
    taxCode?: string;

    @IsOptional()
    @IsString()
    @Length(2, 160)
    @Matches(PERSON_NAME_PATTERN, {
        message: 'Tên người đại diện không được chứa chữ số',
    })
    representativeName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    representativeRole?: string;

    @IsOptional()
    @IsString()
    @Matches(/^(0|\+84)\d{9,10}$/, {
        message: 'phone must be a valid Vietnamese phone number',
    })
    phone?: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(254)
    email?: string;

    // Shape tài liệu còn linh hoạt theo profileType; validator application sẽ kiểm tra đúng key/url bắt buộc khi submit.
    @IsOptional()
    documents?: Record<string, unknown>;
}
