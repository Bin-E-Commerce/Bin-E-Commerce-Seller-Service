import { SellerApplicationStatus } from "../enums/seller-application-status.enum";
import { SellerProfileType } from "../enums/seller-profile-type.enum";
import { PayoutAccountType } from "../enums/payout-account-type.enum";

export interface SellerApplicationResponseDto {
  id: string;
  status: SellerApplicationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  shop: {
    name: string | null;
    slug: string | null;
    mainCategoryId: string | null;
    businessModel: string | null;
    description: string | null;
    logoUrl: string | null;
  };
  seller: {
    profileType: SellerProfileType;
    legalName: string | null;
    citizenId: string | null;
    taxCode: string | null;
    representativeName: string | null;
    representativeRole: string | null;
    phone: string | null;
    email: string | null;
    documents: Record<string, unknown>;
  };
  pickupAddress: {
    contactName: string | null;
    phone: string | null;
    provinceId: string | null;
    wardId: string | null;
    addressLine: string | null;
  };
  payout: {
    bankCode: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountHolderName: string | null;
    accountType: PayoutAccountType;
    branch: string | null;
  };
  createdAt: Date;
  updatedAt: Date;
}
