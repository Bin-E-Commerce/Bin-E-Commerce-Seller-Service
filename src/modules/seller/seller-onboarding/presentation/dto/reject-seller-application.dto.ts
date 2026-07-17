import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { SellerApplicationCorrectionTarget } from "../../../../../database/enums/seller-application-correction-target.enum";

export class RejectSellerApplicationDto {
  // Lý do là dữ liệu bắt buộc để seller biết chính xác nội dung cần sửa trước khi gửi lại hồ sơ.
  @IsString()
  @MinLength(10, {
    message: "Lý do từ chối cần có ít nhất 10 ký tự.",
  })
  @MaxLength(1000, {
    message: "Lý do từ chối không được vượt quá 1000 ký tự.",
  })
  reason: string;

  // Admin phải chỉ rõ ít nhất một nhóm cần sửa để backend có thể kiểm chứng lần gửi lại thay vì chỉ dựa vào ghi chú tự do.
  @IsArray()
  @ArrayMinSize(1, {
    message: "Vui lòng chọn ít nhất một nhóm thông tin cần chỉnh sửa.",
  })
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsEnum(SellerApplicationCorrectionTarget, { each: true })
  correctionTargets: SellerApplicationCorrectionTarget[];
}
