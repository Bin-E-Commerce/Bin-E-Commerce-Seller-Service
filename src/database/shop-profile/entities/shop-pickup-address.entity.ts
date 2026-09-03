// Entity này lưu địa chỉ lấy hàng độc lập với hồ sơ shop để thay đổi sau này không ảnh hưởng shipment snapshot.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

// Mỗi địa chỉ thuộc đúng một shop; ownership được resolve từ JWT ở service.
@Entity("shop_pickup_addresses")
@Index(["shopId", "isDefault"])
export class ShopPickupAddress {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "shop_id", type: "uuid" })
  shopId!: string;

  @Column({ name: "contact_name", type: "varchar", length: 160 })
  contactName!: string;

  @Column({ type: "varchar", length: 20 })
  phone!: string;

  @Column({ name: "ghn_province_id", type: "int", nullable: true })
  ghnProvinceId!: number | null;

  @Column({ name: "ghn_province_name", type: "varchar", length: 160, nullable: true })
  ghnProvinceName!: string | null;

  @Column({ name: "ghn_district_id", type: "int", nullable: true })
  ghnDistrictId!: number | null;

  @Column({ name: "ghn_district_name", type: "varchar", length: 160, nullable: true })
  ghnDistrictName!: string | null;

  @Column({ name: "ghn_ward_code", type: "varchar", length: 30, nullable: true })
  ghnWardCode!: string | null;

  @Column({ name: "ghn_ward_name", type: "varchar", length: 160, nullable: true })
  ghnWardName!: string | null;

  @Column({ name: "address_line", type: "text" })
  addressLine!: string;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
