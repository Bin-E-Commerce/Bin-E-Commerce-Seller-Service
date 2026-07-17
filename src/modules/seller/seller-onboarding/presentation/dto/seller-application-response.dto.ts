import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerApplicationStatus } from "../../../../../database/enums/seller-application-status.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SellerApplicationCorrectionTarget } from "../../../../../database/enums/seller-application-correction-target.enum";

export interface SellerApplicationResponseDto {
  id: string;
  userId: string;
  userEmail: string;
  status: SellerApplicationStatus;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  correctionTargets: SellerApplicationCorrectionTarget[];
  submissionRevision: number;
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
