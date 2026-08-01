import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

export class UpdateShopProfileDto {
  @IsOptional()
  @IsString()
  @Length(3, 120, {
    message: "Tên shop phải có từ 3 đến 120 ký tự.",
  })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: "Mô tả shop không được vượt quá 1000 ký tự.",
  })
  @Matches(/^[^\uFFFD]*$/u, {
    message:
      "Mô tả shop chứa ký tự lỗi. Vui lòng nhập lại nội dung bằng Unicode UTF-8.",
  })
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: "URL logo shop không hợp lệ." })
  @MaxLength(2048)
  logoUrl?: string;

  @IsOptional()
  @IsEmail({}, { message: "Email liên hệ không hợp lệ." })
  @MaxLength(255)
  contactEmail?: string;

  @IsOptional()
  @Matches(/^0\d{9}$/, {
    message: "Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0.",
  })
  contactPhone?: string;
}
