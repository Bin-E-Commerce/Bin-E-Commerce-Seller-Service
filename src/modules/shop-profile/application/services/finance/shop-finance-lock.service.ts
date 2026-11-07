// Use case khóa storefront khi ví nợ đến hạn mức/quá hạn và chỉ mở lại khi Order Service xác nhận đã hết nợ.
import { Inject, Injectable } from '@nestjs/common';
import { SHOP_FINANCE_LOCK_REPOSITORY } from '@/modules/shop-profile/application/contracts/shop-finance-lock.repository';
import type { ShopFinanceLockRepositoryPort } from '@/modules/shop-profile/application/contracts/shop-finance-lock.repository';

@Injectable()
export class ShopFinanceLockService {
    constructor(
        @Inject(SHOP_FINANCE_LOCK_REPOSITORY)
        private readonly repository: ShopFinanceLockRepositoryPort,
    ) {}

    // Chuyển yêu cầu từ service tài chính sang adapter có khóa row để lệnh lặp không đổi trạng thái sai.
    async setFinanceLock(shopId: string, locked: boolean): Promise<void> {
        await this.repository.setFinanceLock(shopId, locked);
    }

    // Trả readiness cho Product Service để checkout chặn shop tài chính đã bị tạm ngưng.
    async findInactiveShopIds(shopIds: string[]): Promise<string[]> {
        return this.repository.findInactiveShopIds(shopIds);
    }
}
