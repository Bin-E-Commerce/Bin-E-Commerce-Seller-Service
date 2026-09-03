import { PayoutAccountType } from "../../../../database/shared/enums/payout-account-type.enum";

// Shape đã chuẩn hóa được lưu trong JSONB; chỉ field thật sự thay đổi mới xuất hiện trong từng section.
export interface ShopProfileRequestedChanges {
  tax?: {
    legalName?: string;
    taxCode?: string | null;
    invoiceEmail?: string;
  };
  payout?: {
    bankCode?: string;
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    accountType?: PayoutAccountType;
    branch?: string | null;
  };
  identity?: {
    legalName?: string;
    citizenId?: string | null;
    representativeName?: string;
    representativeRole?: string | null;
    contactEmail?: string;
    contactPhone?: string;
    documents?: Record<string, unknown>;
  };
}

// Snapshot dùng cùng shape với requestedChanges để admin so sánh đúng từng field trước và sau.
export type ShopProfileCurrentSnapshot = ShopProfileRequestedChanges;
