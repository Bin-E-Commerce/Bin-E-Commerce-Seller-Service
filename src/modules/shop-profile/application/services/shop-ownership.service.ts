import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Shop } from "../../../../database/shop-profile/entities/shop.entity";

@Injectable()
export class ShopOwnershipService {
  // Resolver ownership dùng chung để mọi use case đều truy vấn shop bằng userId tin cậy thay vì shopId từ client.
  constructor(
    @InjectRepository(Shop)
    private readonly shopRepository: Repository<Shop>,
  ) {}

  // Tìm shop theo userId tin cậy; thao tác đọc không tự tạo shop để lỗi provisioning không bị che khuất.
  async findOwnedShopOrThrow(ownerUserId: string): Promise<Shop> {
    const shop = await this.shopRepository.findOne({
      where: { ownerUserId },
    });
    if (!shop) {
      throw new NotFoundException(
        "Shop chưa được kích hoạt hoặc hồ sơ người bán chưa được duyệt.",
      );
    }

    return shop;
  }
}
