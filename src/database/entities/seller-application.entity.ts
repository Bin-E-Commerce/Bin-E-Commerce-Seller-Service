import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { PayoutAccountType } from "../enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../enums/seller-application-status.enum";
import { SellerProfileType } from "../enums/seller-profile-type.enum";
import { SellerApplicationCorrectionTarget } from "../enums/seller-application-correction-target.enum";

@Entity("seller_applications")
@Index(["userId"], { unique: true })
@Index(["shopSlug"], { unique: true })
@Index(["status"])
export class SellerApplication {
  // ID nội bộ của hồ sơ đăng ký người bán, dùng cho admin review và audit sau này.
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // User đã đăng ký tài khoản trong auth-service; mỗi user chỉ có một hồ sơ seller active.
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  // Email lấy từ JWT context để gửi thông báo và hiển thị cho admin khi duyệt.
  @Column({ name: "user_email", type: "varchar", length: 255 })
  userEmail: string;

  // Trạng thái hồ sơ; pending_review chờ admin duyệt, approved mới được cấp quyền seller.
  @Column({
    type: "enum",
    enum: SellerApplicationStatus,
    default: SellerApplicationStatus.DRAFT,
  })
  status: SellerApplicationStatus;

  // Tên shop hiển thị công khai nếu hồ sơ được duyệt.
  @Column({ name: "shop_name", type: "varchar", length: 120, nullable: true })
  shopName: string | null;

  // Slug shop dùng cho URL và chống trùng tên đường dẫn giữa các seller.
  @Column({ name: "shop_slug", type: "varchar", length: 140, nullable: true })
  shopSlug: string | null;

  // Ngành hàng chính lấy từ catalog-service, dùng để định tuyến rule sản phẩm ban đầu.
  @Column({
    name: "main_category_id",
    type: "uuid",
    nullable: true,
  })
  mainCategoryId: string | null;

  // Mô hình bán hàng như bán lẻ, thương hiệu chính hãng hoặc nhà phân phối.
  @Column({
    name: "business_model",
    type: "varchar",
    length: 40,
    nullable: true,
  })
  businessModel: string | null;

  // Mô tả ngắn của shop để admin hiểu định vị bán hàng trước khi duyệt.
  @Column({ name: "shop_description", type: "text", nullable: true })
  shopDescription: string | null;

  // Logo shop bắt buộc khi gửi duyệt; URL thường đến từ media-service/CDN.
  @Column({ name: "logo_url", type: "text", nullable: true })
  logoUrl: string | null;

  // Phân loại hồ sơ để biết cần đối chiếu CCCD hay giấy tờ doanh nghiệp.
  @Column({
    name: "profile_type",
    type: "enum",
    enum: SellerProfileType,
    default: SellerProfileType.INDIVIDUAL,
  })
  profileType: SellerProfileType;

  // Tên pháp lý với doanh nghiệp hoặc họ tên trên CCCD với cá nhân/hộ kinh doanh.
  @Column({ name: "legal_name", type: "varchar", length: 180, nullable: true })
  legalName: string | null;

  // Số CCCD cho hồ sơ cá nhân; nullable vì doanh nghiệp dùng taxCode.
  @Column({ name: "citizen_id", type: "varchar", length: 20, nullable: true })
  citizenId: string | null;

  // Mã số thuế cho hồ sơ doanh nghiệp; nullable vì cá nhân dùng citizenId.
  @Column({ name: "tax_code", type: "varchar", length: 30, nullable: true })
  taxCode: string | null;

  // Người đại diện vận hành shop, có thể khác chủ giấy tờ trong doanh nghiệp.
  @Column({
    name: "representative_name",
    type: "varchar",
    length: 160,
    nullable: true,
  })
  representativeName: string | null;

  // Vai trò/chức vụ của người đại diện để admin biết ai chịu trách nhiệm vận hành.
  @Column({
    name: "representative_role",
    type: "varchar",
    length: 120,
    nullable: true,
  })
  representativeRole: string | null;

  // Số điện thoại liên hệ chính của hồ sơ seller.
  @Column({
    name: "contact_phone",
    type: "varchar",
    length: 20,
    nullable: true,
  })
  contactPhone: string | null;

  // Email liên hệ chính của hồ sơ seller, có thể khác email đăng nhập.
  @Column({
    name: "contact_email",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  contactEmail: string | null;

  // Danh sách giấy tờ upload từ media-service; jsonb giúp linh hoạt loại giấy tờ theo profileType.
  @Column({
    name: "verification_documents",
    type: "jsonb",
    default: () => "'{}'::jsonb",
  })
  verificationDocuments: Record<string, unknown>;

  // Tên người phụ trách kho/lấy hàng.
  @Column({
    name: "pickup_contact_name",
    type: "varchar",
    length: 160,
    nullable: true,
  })
  pickupContactName: string | null;

  // Số điện thoại dùng cho đơn vị vận chuyển khi lấy hàng.
  @Column({ name: "pickup_phone", type: "varchar", length: 20, nullable: true })
  pickupPhone: string | null;

  // Tỉnh/thành lấy từ location-service để tính vận chuyển.
  @Column({ name: "pickup_province_id", type: "uuid", nullable: true })
  pickupProvinceId: string | null;

  // Phường/xã lấy từ location-service theo tỉnh/thành đã chọn.
  @Column({ name: "pickup_ward_id", type: "uuid", nullable: true })
  pickupWardId: string | null;

  // Địa chỉ chi tiết như số nhà, đường, ghi chú lấy hàng.
  @Column({ name: "pickup_address_line", type: "text", nullable: true })
  pickupAddressLine: string | null;

  // Mã ngân hàng nhận thanh toán theo danh sách FE/backend thống nhất.
  @Column({ name: "bank_code", type: "varchar", length: 60, nullable: true })
  bankCode: string | null;

  // Tên ngân hàng hiển thị tại thời điểm seller gửi hồ sơ.
  @Column({ name: "bank_name", type: "varchar", length: 120, nullable: true })
  bankName: string | null;

  // Số tài khoản nhận thanh toán; không lưu ký tự phân cách để tránh sai đối soát.
  @Column({
    name: "bank_account_number",
    type: "varchar",
    length: 40,
    nullable: true,
  })
  bankAccountNumber: string | null;

  // Tên chủ tài khoản, cần khớp người bán hoặc pháp nhân.
  @Column({
    name: "bank_account_holder_name",
    type: "varchar",
    length: 180,
    nullable: true,
  })
  bankAccountHolderName: string | null;

  // Loại tài khoản nhận tiền: cá nhân/hộ kinh doanh hoặc doanh nghiệp.
  @Column({
    name: "bank_account_type",
    type: "enum",
    enum: PayoutAccountType,
    default: PayoutAccountType.PERSONAL,
  })
  bankAccountType: PayoutAccountType;

  // Chi nhánh/khu vực ngân hàng, không bắt buộc vì nhiều ngân hàng không cần khi chuyển khoản.
  @Column({ name: "bank_branch", type: "varchar", length: 160, nullable: true })
  bankBranch: string | null;

  // Thời điểm seller bấm gửi duyệt.
  @Column({ name: "submitted_at", type: "timestamptz", nullable: true })
  submittedAt: Date | null;

  // Thời điểm admin xử lý hồ sơ, dùng cho màn hình trạng thái sau này.
  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt: Date | null;

  // Ghi chú admin khi từ chối hoặc yêu cầu bổ sung.
  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote: string | null;

  // Các nhóm dữ liệu admin yêu cầu sửa; seller phải thay đổi từng nhóm trước khi backend nhận lần gửi kế tiếp.
  @Column({
    name: "correction_targets",
    type: "jsonb",
    default: () => "'[]'::jsonb",
  })
  correctionTargets: SellerApplicationCorrectionTarget[];

  // Chỉ lưu SHA-256 của snapshot theo nhóm để so sánh thay đổi mà không nhân bản thêm dữ liệu CCCD, ngân hàng hay giấy tờ nhạy cảm.
  @Column({
    name: "correction_snapshot_hashes",
    type: "jsonb",
    default: () => "'{}'::jsonb",
  })
  correctionSnapshotHashes: Partial<
    Record<SellerApplicationCorrectionTarget, string>
  >;

  // Tăng sau mỗi lần gửi thành công để admin phân biệt các phiên bản hồ sơ qua nhiều vòng bổ sung.
  @Column({ name: "submission_revision", type: "int", default: 0 })
  submissionRevision: number;

  // Metadata mở rộng cho các tích hợp tương lai như OCR, bank verification hoặc fraud score.
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  // Thời điểm tạo hồ sơ lần đầu.
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  // Thời điểm cập nhật gần nhất khi lưu nháp, submit hoặc admin review.
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
