// Context danh tính đã được chuẩn hóa từ header nội bộ; các use case chỉ phụ thuộc type này thay vì phụ thuộc HTTP Request.
export interface CurrentUserContext {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}
