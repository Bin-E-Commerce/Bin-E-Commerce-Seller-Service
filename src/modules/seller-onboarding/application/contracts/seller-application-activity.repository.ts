// Port thống kê lần gửi hồ sơ seller; application không phụ thuộc TypeORM hoặc tên cột persistence.
export const SELLER_APPLICATION_ACTIVITY_REPOSITORY = Symbol(
    'SELLER_APPLICATION_ACTIVITY_REPOSITORY',
);

export interface SellerApplicationActivityDailyCount {
    day: string;
    count: number;
}

export interface SellerApplicationActivityRepositoryPort {
    getSubmittedApplicationsDaily(
        from: string,
        to: string,
    ): Promise<SellerApplicationActivityDailyCount[]>;
}
