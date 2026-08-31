// Chuẩn hóa chuỗi rỗng thành null để rule missing field, unique slug và mapper dùng cùng một cách hiểu dữ liệu.
export function toNullableString(value: unknown): string | null {
  const normalized = typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : null;
  return normalized ? normalized : null;
}
