// Context tối thiểu của người vận hành shop, được dựng từ header nội bộ do API Gateway ký và chuyển tiếp.
export interface ShopUserContext {
  userId: string;
  email: string;
  permissions: string[];
}
