// Lưu cấu hình vận hành giao nhận cấp shop; credential GHN thuộc platform.

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("shop_shipping_settings")
export class ShopShippingSettings {
  @PrimaryColumn({ name: "shop_id", type: "uuid" })
  shopId!: string;

  @Column({ name: "default_pickup_address_id", type: "uuid", nullable: true })
  defaultPickupAddressId!: string | null;

  @Column({ name: "onboarding_address_synced", type: "boolean", default: false })
  onboardingAddressSynced!: boolean;

  @Column({ name: "preparation_time_hours", type: "smallint", default: 24 })
  preparationTimeHours!: number;

  @Column({ name: "pickup_window_start", type: "time", default: "08:00" })
  pickupWindowStart!: string;

  @Column({ name: "pickup_window_end", type: "time", default: "18:00" })
  pickupWindowEnd!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
