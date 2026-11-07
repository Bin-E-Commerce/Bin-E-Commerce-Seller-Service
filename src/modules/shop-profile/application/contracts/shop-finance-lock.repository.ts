// Port cập nhật trạng thái khóa công nợ; mọi transaction và truy vấn Shop thuộc infrastructure.
export const SHOP_FINANCE_LOCK_REPOSITORY = Symbol(
    'SHOP_FINANCE_LOCK_REPOSITORY',
);

export interface ShopFinanceLockRepositoryPort {
    setFinanceLock(shopId: string, locked: boolean): Promise<void>;
    findInactiveShopIds(shopIds: string[]): Promise<string[]>;
}
