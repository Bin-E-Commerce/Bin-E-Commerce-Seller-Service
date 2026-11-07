// DTO nội bộ giới hạn state mutation thành cờ khóa duy nhất do Order Service đã xác thực yêu cầu.
import { IsBoolean } from 'class-validator';

export class SetShopFinanceLockDto {
    @IsBoolean()
    locked!: boolean;
}
