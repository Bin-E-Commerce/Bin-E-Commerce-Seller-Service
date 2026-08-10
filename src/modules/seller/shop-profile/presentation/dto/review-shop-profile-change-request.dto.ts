import { IsOptional, IsString, Length, MaxLength } from "class-validator";

export class ApproveShopProfileChangeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class RejectShopProfileChangeRequestDto {
  @IsString()
  @Length(10, 1000)
  reviewNote: string;
}
