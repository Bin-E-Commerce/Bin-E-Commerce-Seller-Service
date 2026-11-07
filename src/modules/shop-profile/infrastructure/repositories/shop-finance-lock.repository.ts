// Adapter khóa row shop trong transaction; chỉ shop đang hoạt động mới được khóa bởi công nợ.
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Shop } from '@/database/shop-profile/entities/shop.entity';
import { ShopStatus } from '@/database/shop-profile/enums/shop-status.enum';
import type { ShopFinanceLockRepositoryPort } from '@/modules/shop-profile/application/contracts/shop-finance-lock.repository';

@Injectable()
export class ShopFinanceLockRepository implements ShopFinanceLockRepositoryPort {
    constructor(private readonly dataSource: DataSource) {}

    // Khóa row để thao tác trả nợ/mở shop và phát sinh nợ/khóa shop không ghi đè trạng thái lẫn nhau.
    async setFinanceLock(shopId: string, locked: boolean): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(Shop);
            const shop = await repository.findOne({
                where: { id: shopId },
                lock: { mode: 'pessimistic_write' },
            });
            // Dừng cả transaction khi ID upstream không còn tồn tại để caller có thể retry/điều tra dữ liệu lệch.
            if (!shop)
                throw new NotFoundException(
                    'Không tìm thấy shop cần cập nhật.',
                );

            if (locked) {
                // Shop đã bị đóng hoặc khóa thủ công không bị ghi nhận nhầm là khóa do nợ.
                if (shop.status !== ShopStatus.ACTIVE) return;
                shop.status = ShopStatus.SUSPENDED;
                shop.financeLocked = true;
            } else {
                // Chỉ trạng thái do tài chính đặt mới được tự mở; shop đóng thủ công giữ nguyên.
                if (!shop.financeLocked) return;
                shop.financeLocked = false;
                if (shop.status === ShopStatus.SUSPENDED)
                    shop.status = ShopStatus.ACTIVE;
            }

            await repository.save(shop);
        });
    }

    // Một truy vấn đọc readiness theo lô; ID không có trong DB cũng bị coi là không đủ điều kiện bán.
    async findInactiveShopIds(shopIds: string[]): Promise<string[]> {
        if (shopIds.length === 0) return [];
        const rows = (await this.dataSource.query(
            `SELECT id, status FROM shops WHERE id = ANY($1::uuid[])`,
            [shopIds],
        )) as Array<{ id: string; status: ShopStatus }>;
        const activeIds = new Set(
            rows
                .filter((shop) => shop.status === ShopStatus.ACTIVE)
                .map((shop) => shop.id),
        );
        return shopIds.filter((shopId) => !activeIds.has(shopId));
    }
}
