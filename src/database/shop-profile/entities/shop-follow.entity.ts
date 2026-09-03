// Quan hệ theo dõi shop của customer/seller.
// Bảng này thuộc Seller Service vì shop và lifecycle của shop thuộc bounded context Seller.

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Shop } from "./shop.entity";

// Entity lưu quan hệ follow và giữ unique constraint ở database để bảo vệ counter trước request trùng.
@Entity("shop_follows")
@Index(["shopId", "followerUserId"], { unique: true })
@Index(["followerUserId", "createdAt"])
@Index(["shopId", "createdAt"])
export class ShopFollow {
  // ID kỹ thuật của một lần theo dõi.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Shop được theo dõi; foreign key local giúp xóa shop không để lại quan hệ mồ côi.
  @Column({ name: "shop_id", type: "uuid" })
  shopId: string;

  // User ID từ Gateway/Auth; không tạo FK cross-service vì user thuộc Auth Service.
  @Column({ name: "follower_user_id", type: "uuid" })
  followerUserId: string;

  // Relation chỉ dùng cho persistence/query, không serialize toàn bộ Shop trong public response.
  @ManyToOne(() => Shop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "shop_id" })
  shop: Shop;

  // Thời điểm bắt đầu theo dõi, dùng cho audit và các thống kê theo thời gian sau này.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}
