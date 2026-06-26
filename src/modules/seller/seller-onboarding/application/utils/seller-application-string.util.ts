// Chuẩn hóa chuỗi rỗng thành null để rule missing field, unique slug và mapper dùng cùng một cách hiểu dữ liệu.
export function toNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
