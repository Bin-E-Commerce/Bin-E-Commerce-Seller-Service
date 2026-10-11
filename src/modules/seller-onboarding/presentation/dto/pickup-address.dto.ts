// DTO địa chỉ kho; mã tỉnh/quận là số, còn tên và địa chỉ là chuỗi.
import {
    IsInt,
    IsOptional,
    IsString,
    Length,
    Matches,
    MaxLength,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const PERSON_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*$/u;

// Xác thực địa chỉ GHN và người phụ trách lấy hàng trước khi service cập nhật hồ sơ.
export class PickupAddressDto {
    @IsOptional()
    @IsString()
    @Length(2, 160)
    @Matches(PERSON_NAME_PATTERN, {
        message: 'Tên người phụ trách không được chứa chữ số',
    })
    contactName?: string;

    @IsOptional()
    @IsString()
    @Matches(/^(0|\+84)\d{9,10}$/, {
        message: 'phone must be a valid Vietnamese phone number',
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
