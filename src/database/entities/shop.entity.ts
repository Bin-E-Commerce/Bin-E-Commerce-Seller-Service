import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { SellerApplication } from "./seller-application.entity";
import { ShopStatus } from "../enums/shop-status.enum";

@Entity("shops")
@Index(["ownerUserId"], { unique: true })
@Index(["slug"], { unique: true })
@Index(["status"])
export class Shop {
  // ID nghiệp vụ ổn định để product-service và các service khác tham chiếu shop mà không phụ thuộc hồ sơ xét duyệt.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Chủ sở hữu lấy từ auth-service; mỗi tài khoản seller hiện chỉ được vận hành một shop.
  @Column({ name: "owner_user_id", type: "uuid" })
  ownerUserId: string;

  // Hồ sơ đã được admin duyệt là nguồn tạo shop và là dấu vết kiểm toán cho thông tin pháp lý ban đầu.
  @Column({ name: "seller_application_id", type: "uuid", unique: true })
  sellerApplicationId: string;

  @OneToOne(() => SellerApplication, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "seller_application_id" })
  sellerApplication: SellerApplication;

  // Tên công khai được phép chỉnh sửa sau khi shop hoạt động.
  @Column({ type: "varchar", length: 120 })
  name: string;

  // Slug công khai được giữ cố định sau khi duyệt để URL sản phẩm và SEO không bị gãy.
  @Column({ type: "varchar", length: 140 })
  slug: string;

  // Logo đã qua media-service; URL có thể trỏ đến CDN nhưng không chứa quyền truy cập S3.
  @Column({ name: "logo_url", type: "text" })
  logoUrl: string;

  // Mô tả công khai giúp khách hàng hiểu ngành hàng và cam kết dịch vụ của shop.
  @Column({ type: "text", nullable: true })
  description: string | null;

  // Chỉ lưu ID danh mục do catalog-service sở hữu để tránh nhân bản master data.
  @Column({ name: "main_category_id", type: "uuid" })
  mainCategoryId: string;

  // Mô hình bán hàng đã duyệt được giữ làm dữ liệu phân loại vận hành.
  @Column({ name: "business_model", type: "varchar", length: 40 })
  businessModel: string;

  // Email liên hệ công khai của shop, tách khỏi email đăng nhập và email pháp lý.
  @Column({ name: "contact_email", type: "varchar", length: 255 })
  contactEmail: string;

  // Số điện thoại hỗ trợ công khai, không làm thay đổi dữ liệu định danh trong hồ sơ duyệt.
  @Column({ name: "contact_phone", type: "varchar", length: 20 })
  contactPhone: string;

  // Trạng thái vận hành độc lập với trạng thái onboarding để có thể tạm khóa shop mà không sửa lịch sử xét duyệt.
  @Column({
    type: "enum",
    enum: ShopStatus,
    default: ShopStatus.ACTIVE,
  })
  status: ShopStatus;

  // Thời điểm shop được xác minh và kích hoạt từ hồ sơ seller.
  @Column({ name: "verified_at", type: "timestamptz" })
  verifiedAt: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
