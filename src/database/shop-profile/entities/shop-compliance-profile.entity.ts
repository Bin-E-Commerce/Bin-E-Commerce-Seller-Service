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
import { PayoutAccountType } from "../../shared/enums/payout-account-type.enum";
import { SellerProfileType } from "../../shared/enums/seller-profile-type.enum";
import { Shop } from "./shop.entity";

@Entity("shop_compliance_profiles")
@Index(["shopId"], { unique: true })
export class ShopComplianceProfile {
  // ID riêng giúp hồ sơ pháp lý có vòng đời độc lập với shop và hồ sơ onboarding ban đầu.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Mỗi shop chỉ có một bộ thông tin pháp lý đang có hiệu lực tại một thời điểm.
  @Column({ name: "shop_id", type: "uuid" })
  shopId: string;

  @OneToOne(() => Shop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "shop_id" })
  shop: Shop;

  // Loại hồ sơ được khóa sau onboarding; chuyển loại cá nhân/doanh nghiệp cần quy trình đăng ký lại riêng.
  @Column({ name: "profile_type", type: "enum", enum: SellerProfileType })
  profileType: SellerProfileType;

  // Tên pháp lý hiện hành dùng để đối chiếu thuế, định danh và chủ tài khoản nhận tiền.
  @Column({ name: "legal_name", type: "varchar", length: 180 })
  legalName: string;

  // CCCD chỉ áp dụng cho cá nhân/hộ kinh doanh và được bảo vệ như dữ liệu nhạy cảm.
  @Column({ name: "citizen_id", type: "varchar", length: 20, nullable: true })
  citizenId: string | null;

  // Mã số thuế áp dụng cho doanh nghiệp hoặc hồ sơ có đăng ký thuế.
  @Column({ name: "tax_code", type: "varchar", length: 30, nullable: true })
  taxCode: string | null;

  // Người đại diện vận hành/pháp lý hiện được hệ thống công nhận.
  @Column({ name: "representative_name", type: "varchar", length: 160 })
  representativeName: string;

  // Vai trò của người đại diện, ví dụ chủ shop hoặc giám đốc.
  @Column({
    name: "representative_role",
    type: "varchar",
    length: 120,
    nullable: true,
  })
  representativeRole: string | null;

  // Email pháp lý dùng cho hóa đơn và trao đổi xác minh, tách khỏi email hỗ trợ công khai của shop.
  @Column({ name: "legal_contact_email", type: "varchar", length: 255 })
  legalContactEmail: string;

  // Số điện thoại pháp lý dùng khi cần xác minh lại hồ sơ.
  @Column({ name: "legal_contact_phone", type: "varchar", length: 20 })
  legalContactPhone: string;

  // Metadata giấy tờ đã được duyệt; URL chỉ được trả cho luồng admin có quyền, không trả ở hồ sơ công khai.
  @Column({
    name: "verification_documents",
    type: "jsonb",
    default: () => "'{}'::jsonb",
  })
  verificationDocuments: Record<string, unknown>;

  // Mã ngân hàng chuẩn hóa để tích hợp đối soát và thanh toán về sau.
  @Column({ name: "bank_code", type: "varchar", length: 60 })
  bankCode: string;

  // Tên ngân hàng được lưu cùng mã để hiển thị ổn định dù danh mục ngân hàng thay đổi.
  @Column({ name: "bank_name", type: "varchar", length: 120 })
  bankName: string;

  // Số tài khoản nhận tiền; response thông thường chỉ trả phiên bản đã che.
  @Column({ name: "bank_account_number", type: "varchar", length: 40 })
  bankAccountNumber: string;

  // Tên chủ tài khoản phải phù hợp với cá nhân hoặc pháp nhân đã xác minh.
  @Column({ name: "bank_account_holder_name", type: "varchar", length: 180 })
  bankAccountHolderName: string;

  // Phân biệt tài khoản cá nhân và doanh nghiệp để áp dụng rule đối soát phù hợp.
  @Column({ name: "bank_account_type", type: "enum", enum: PayoutAccountType })
  bankAccountType: PayoutAccountType;

  // Chi nhánh không bắt buộc nhưng hữu ích cho một số luồng xác minh ngân hàng thủ công.
  @Column({ name: "bank_branch", type: "varchar", length: 160, nullable: true })
  bankBranch: string | null;

  // Tăng sau mỗi lần admin duyệt thay đổi để hỗ trợ optimistic check và audit về sau.
  @Column({ type: "integer", default: 1 })
  version: number;

  // Thời điểm bộ dữ liệu hiện tại được xác minh gần nhất.
  @Column({ name: "verified_at", type: "timestamptz" })
  verifiedAt: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
