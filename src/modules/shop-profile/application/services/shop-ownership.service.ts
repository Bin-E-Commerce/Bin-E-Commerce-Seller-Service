import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shop } from '@/database/shop-profile/entities/shop.entity';

@Injectable()
export class ShopOwnershipService {
    // Resolver ownership dùng chung để mọi use case truy vấn shop bằng userId tin cậy.
    constructor(
        @InjectRepository(Shop)
        private readonly shopRepository: Repository<Shop>,
    ) {}

    // Giữ null khi shop chưa tồn tại để Auth Service chỉ lấy logo không làm lỗi login.
    async findOwnedShop(ownerUserId: string): Promise<Shop | null> {
        return this.shopRepository.findOne({
            where: { ownerUserId },
        });
    }

    // Ném lỗi cho các nghiệp vụ bắt buộc user phải có shop đã được kích hoạt.
    async findOwnedShopOrThrow(ownerUserId: string): Promise<Shop> {
        const shop = await this.shopRepository.findOne({
            where: { ownerUserId },
        });
        if (!shop) {
            throw new NotFoundException(
                'Shop chưa được kích hoạt hoặc hồ sơ người bán chưa được duyệt.',
            );
        }

        return shop;
    }
}
