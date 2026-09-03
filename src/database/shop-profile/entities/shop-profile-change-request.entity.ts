import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ShopProfileChangeRequestStatus } from "../enums/shop-profile-change-request-status.enum";
import { ShopProfileChangeSection } from "../enums/shop-profile-change-section.enum";
import { Shop } from "./shop.entity";

@Entity("shop_profile_change_requests")
@Index(["shopId", "status"])
@Index(["requesterUserId"])
@Index(["submittedAt"])
export class ShopProfileChangeRequest {
  // ID yêu cầu được dùng trong URL admin và audit log, không dùng ID shop thay thế để giữ lịch sử nhiều lần thay đổi.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Shop chịu tác động; ownership vẫn được suy ra từ phiên đăng nhập thay vì nhận shopId từ frontend seller.
  @Column({ name: "shop_id", type: "uuid" })
  shopId: string;

  @ManyToOne(() => Shop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "shop_id" })
  shop: Shop;

  // User tạo yêu cầu để truy vết ngay cả khi quyền hoặc nhân sự shop thay đổi sau này.
  @Column({ name: "requester_user_id", type: "uuid" })
  requesterUserId: string;

  // Các section giúp admin lọc nhanh yêu cầu liên quan thuế, thanh toán hoặc định danh.
  @Column({
    name: "sections",
    type: "enum",
    enum: ShopProfileChangeSection,
    array: true,
  })
  sections: ShopProfileChangeSection[];

  // Snapshot chỉ chứa các field sắp đổi để màn hình admin so sánh trước/sau mà không đọc lại dữ liệu đã biến động.
  @Column({ name: "current_snapshot", type: "jsonb" })
  currentSnapshot: Record<string, unknown>;

  // Payload đã chuẩn hóa chờ duyệt; không áp dụng vào hồ sơ có hiệu lực trước khi admin chấp thuận.
  @Column({ name: "requested_changes", type: "jsonb" })
  requestedChanges: Record<string, unknown>;

  // Version compliance tại lúc seller gửi yêu cầu; admin chỉ được duyệt khi hồ sơ hiệu lực vẫn ở đúng version này.
  @Column({ name: "base_compliance_version", type: "integer", default: 1 })
  baseComplianceVersion: number;

  // Lý do do seller cung cấp giúp admin hiểu mục đích thay đổi và giảm trao đổi bổ sung.
  @Column({ name: "request_note", type: "varchar", length: 500 })
  requestNote: string;

  // Trạng thái request độc lập với trạng thái vận hành của shop.
  @Column({
    type: "enum",
    enum: ShopProfileChangeRequestStatus,
    default: ShopProfileChangeRequestStatus.PENDING_REVIEW,
  })
  status: ShopProfileChangeRequestStatus;

  // ID admin xử lý được lấy từ JWT đã xác thực và để null trong lúc đang chờ.
  @Column({ name: "reviewed_by", type: "uuid", nullable: true })
  reviewedBy: string | null;

  // Ghi chú bắt buộc khi từ chối và tùy chọn khi chấp thuận.
  @Column({
    name: "review_note",
    type: "varchar",
    length: 1000,
    nullable: true,
  })
  reviewNote: string | null;

  // Thời điểm seller hoàn tất gửi yêu cầu.
  @Column({ name: "submitted_at", type: "timestamptz" })
  submittedAt: Date;

  // Thời điểm admin đưa ra quyết định cuối cùng.
  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
