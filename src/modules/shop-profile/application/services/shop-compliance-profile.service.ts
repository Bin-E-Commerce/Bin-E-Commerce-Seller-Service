import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ShopComplianceProfile } from "../../../../database/shop-profile/entities/shop-compliance-profile.entity";

@Injectable()
export class ShopComplianceProfileService {
  // Hồ sơ compliance được tạo trong transaction duyệt onboarding; service đọc không được phát sinh side effect ghi DB.
  constructor(
    @InjectRepository(ShopComplianceProfile)
    private readonly complianceRepository: Repository<ShopComplianceProfile>,
  ) {}

  // Trả bộ dữ liệu đã được duyệt đang có hiệu lực hoặc yêu cầu chạy backfill cho dữ liệu legacy còn thiếu.
  async findByShopIdOrThrow(shopId: string): Promise<ShopComplianceProfile> {
    const profile = await this.complianceRepository.findOne({
      where: { shopId },
    });
    if (!profile) {
      throw new NotFoundException(
        "Shop chưa có hồ sơ xác minh. Vui lòng chạy backfill dữ liệu seller cũ.",
      );
    }

    return profile;
  }
}
