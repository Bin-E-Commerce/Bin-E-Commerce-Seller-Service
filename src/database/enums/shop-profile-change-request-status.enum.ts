// Trạng thái vòng đời của một yêu cầu thay đổi hồ sơ nhạy cảm sau khi shop đã được xác minh.
export enum ShopProfileChangeRequestStatus {
  PENDING_REVIEW = "pending_review",
  APPROVED = "approved",
  REJECTED = "rejected",
  CANCELLED = "cancelled",
}
