// Use case đọc và thay đổi trạng thái follow của shop public.
// Business rule follow nằm ở Seller Service để counter và relation luôn thay đổi trong cùng transaction.

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { Shop } from "../../../../database/shop-profile/entities/shop.entity";
import { ShopFollow } from "../../../../database/shop-profile/entities/shop-follow.entity";
import { ShopPickupAddress } from "../../../../database/shop-profile/entities/shop-pickup-address.entity";
import { ShopStatus } from "../../../../database/shop-profile/enums/shop-status.enum";
import type { PublicShopResponseDto } from "../../presentation/dto/public-shop-response.dto";
import type { ListPublicShopsQueryDto } from "../../presentation/dto/list-public-shops-query.dto";
import type { PublicShopListResponseDto } from "../../presentation/dto/public-shop-list-response.dto";
import { AuthUserClient } from "../clients/auth-user.client";

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

// Application service gom read model shop và transaction follow, không để controller chứa nghiệp vụ.
@Injectable()
export class PublicShopService {
  constructor(
    @InjectRepository(Shop) private readonly shopRepository: Repository<Shop>,
    @InjectRepository(ShopFollow)
    private readonly followRepository: Repository<ShopFollow>,
    @InjectRepository(ShopPickupAddress)
    private readonly pickupRepository: Repository<ShopPickupAddress>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly authUserClient: AuthUserClient,
  ) {}

  // Đọc danh sách shop active theo một query phân trang và một query pickup address batch.
  // Không gọi auth-service theo từng shop vì màn hình khám phá không cần trạng thái online chính xác; điều này giữ endpoint nhẹ khi số shop tăng.
  async listPublicShops(
    query: ListPublicShopsQueryDto,
  ): Promise<PublicShopListResponseDto> {
    const builder = this.shopRepository
      .createQueryBuilder("shop")
      .leftJoin(
        ShopPickupAddress,
        "pickupAddress",
        "pickupAddress.shopId = shop.id AND pickupAddress.isDefault = :isDefault",
        { isDefault: true },
      )
      .where("shop.status = :status", { status: ShopStatus.ACTIVE });
    const search = query.search?.trim();

    // Một từ khóa được dò trên các trường public có ý nghĩa với customer: tên, slug, mô tả và khu vực nhận hàng mặc định.
    // Join chỉ dùng cho bước lọc; response vẫn lấy pickup address theo batch query bên dưới để giữ shape và tránh N+1.
    if (search) {
      builder.andWhere(
        `(
          shop.name ILIKE :search
          OR shop.slug ILIKE :search
          OR shop.description ILIKE :search
          OR pickupAddress.ghnProvinceName ILIKE :search
          OR pickupAddress.ghnDistrictName ILIKE :search
        )`,
        { search: `%${search}%` },
      );
    }

    const [shops, total] = await builder
      .orderBy("shop.createdAt", "DESC")
      .addOrderBy("shop.id", "ASC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    if (shops.length === 0) {
      return {
        items: [],
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      };
    }

    const pickupAddresses = await this.pickupRepository.find({
      where: { shopId: In(shops.map((shop) => shop.id)), isDefault: true },
    });
    const pickupByShopId = new Map(
      pickupAddresses.map((address) => [address.shopId, address]),
    );

    return {
      items: shops.map((shop) => {
        const pickupAddress = pickupByShopId.get(shop.id);
        return {
          shop: {
            id: shop.id,
            slug: shop.slug,
            name: shop.name,
            logoUrl: shop.logoUrl,
            description: shop.description,
            mainCategoryId: shop.mainCategoryId,
            status: shop.status,
            createdAt: shop.createdAt,
            location: {
              province: pickupAddress?.ghnProvinceName ?? null,
              district: pickupAddress?.ghnDistrictName ?? null,
            },
          },
          stats: {
            followerCount: shop.followerCount,
            followingCount: shop.followingCount,
          },
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  // Đọc shop theo slug ưu tiên cho URL SEO, đồng thời hỗ trợ UUID để các màn hình nội bộ có thể mở đúng resource.
  async getPublicShop(
    identifier: string,
    viewerId?: string,
  ): Promise<PublicShopResponseDto> {
    const shop = await this.findShop(identifier);
    const [pickupAddress, lastActiveAt, isFollowing] = await Promise.all([
      this.pickupRepository.findOne({
        where: { shopId: shop.id, isDefault: true },
      }),
      this.authUserClient.getLastActiveAt(shop.ownerUserId),
      viewerId
        ? this.followRepository.exist({
            where: { shopId: shop.id, followerUserId: viewerId },
          })
        : Promise.resolve(false),
    ]);

    return {
      shop: {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        logoUrl: shop.logoUrl,
        description: shop.description,
        mainCategoryId: shop.mainCategoryId,
        status: shop.status,
        createdAt: shop.createdAt,
        location: {
          province: pickupAddress?.ghnProvinceName ?? null,
          district: pickupAddress?.ghnDistrictName ?? null,
        },
      },
      stats: {
        followerCount: shop.followerCount,
        followingCount: shop.followingCount,
      },
      activity: {
        isOnline: this.isOnline(lastActiveAt),
        lastActiveAt,
      },
      isFollowing,
    };
  }

  // Tạo follow idempotent và tăng counter của shop cùng transaction để không lệch khi hai request chạy đồng thời.
  async follow(
    identifier: string,
    viewerId?: string,
  ): Promise<PublicShopResponseDto> {
    if (!viewerId)
      throw new UnauthorizedException("Vui lòng đăng nhập để theo dõi shop.");
    const shop = await this.findShop(identifier);

    await this.dataSource.transaction(async (manager) => {
      const ownerShopSnapshot = await manager
        .getRepository(Shop)
        .findOne({ where: { ownerUserId: viewerId } });
      const lockIds = [shop.id, ownerShopSnapshot?.id]
        .filter((id): id is string => Boolean(id))
        .sort();
      const lockedShops = new Map<string, Shop>();
      for (const lockId of lockIds) {
        const locked = await manager.getRepository(Shop).findOne({
          where: { id: lockId },
          lock: { mode: "pessimistic_write" },
        });
        if (locked) lockedShops.set(locked.id, locked);
      }
      const lockedShop = lockedShops.get(shop.id);
      if (!lockedShop) throw new NotFoundException("Không tìm thấy shop.");
      if (lockedShop.status !== ShopStatus.ACTIVE) {
        throw new ConflictException("Shop hiện không nhận người theo dõi mới.");
      }

      const existing = await manager.getRepository(ShopFollow).findOne({
        where: { shopId: lockedShop.id, followerUserId: viewerId },
      });
      if (existing) return;

      await manager
        .getRepository(ShopFollow)
        .save({ shopId: lockedShop.id, followerUserId: viewerId });
      lockedShop.followerCount += 1;
      const ownerShop = ownerShopSnapshot?.id
        ? lockedShops.get(ownerShopSnapshot.id)
        : undefined;
      if (ownerShop && ownerShop.id !== lockedShop.id)
        ownerShop.followingCount += 1;
      await manager
        .getRepository(Shop)
        .save([lockedShop, ...(ownerShop ? [ownerShop] : [])]);
    });

    return this.getPublicShop(identifier, viewerId);
  }

  // Hủy follow idempotent và giảm đúng counter sau khi relation được khóa trong transaction.
  async unfollow(
    identifier: string,
    viewerId?: string,
  ): Promise<PublicShopResponseDto> {
    if (!viewerId)
      throw new UnauthorizedException(
        "Vui lòng đăng nhập để bỏ theo dõi shop.",
      );
    const shop = await this.findShop(identifier);

    await this.dataSource.transaction(async (manager) => {
      const ownerShopSnapshot = await manager
        .getRepository(Shop)
        .findOne({ where: { ownerUserId: viewerId } });
      const lockIds = [shop.id, ownerShopSnapshot?.id]
        .filter((id): id is string => Boolean(id))
        .sort();
      const lockedShops = new Map<string, Shop>();
      for (const lockId of lockIds) {
        const locked = await manager.getRepository(Shop).findOne({
          where: { id: lockId },
          lock: { mode: "pessimistic_write" },
        });
        if (locked) lockedShops.set(locked.id, locked);
      }
      const lockedShop = lockedShops.get(shop.id);
      if (!lockedShop) throw new NotFoundException("Không tìm thấy shop.");
      const existing = await manager.getRepository(ShopFollow).findOne({
        where: { shopId: lockedShop.id, followerUserId: viewerId },
      });
      if (!existing) return;

      await manager.getRepository(ShopFollow).remove(existing);
      lockedShop.followerCount = Math.max(0, lockedShop.followerCount - 1);
      const ownerShop = ownerShopSnapshot?.id
        ? lockedShops.get(ownerShopSnapshot.id)
        : undefined;
      if (ownerShop && ownerShop.id !== lockedShop.id)
        ownerShop.followingCount = Math.max(0, ownerShop.followingCount - 1);
      await manager
        .getRepository(Shop)
        .save([lockedShop, ...(ownerShop ? [ownerShop] : [])]);
    });

    return this.getPublicShop(identifier, viewerId);
  }

  // UUID được dùng khi có thể, còn mọi identifier khác được coi là slug để tránh query uuid cast lỗi ở PostgreSQL.
  private async findShop(identifier: string): Promise<Shop> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identifier,
      );
    const shop = await this.shopRepository.findOne({
      where: isUuid
        ? [{ id: identifier }, { slug: identifier }]
        : { slug: identifier },
    });
    if (!shop) throw new NotFoundException("Không tìm thấy shop.");
    return shop;
  }

  // Chỉ hiển thị online trong một cửa sổ ngắn; timestamp cũ được hiển thị thành hoạt động gần đây ở frontend.
  private isOnline(lastActiveAt: Date | null): boolean {
    return Boolean(
      lastActiveAt && Date.now() - lastActiveAt.getTime() <= ONLINE_WINDOW_MS,
    );
  }
}
