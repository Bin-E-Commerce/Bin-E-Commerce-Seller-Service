import { IsInt, Max, Min } from 'class-validator';

// Chỉ nhận target mới; expected tồn và tenant được lấy từ proposal đang lưu, không tin snapshot do browser gửi lại.
export class ReviseSellerInventoryProposalDto {
    @IsInt()
    @Min(0)
    @Max(2_147_483_647)
    nextAvailable!: number;
}
