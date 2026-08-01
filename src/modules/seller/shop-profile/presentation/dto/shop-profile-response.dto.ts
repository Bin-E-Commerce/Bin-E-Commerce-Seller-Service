import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { ShopStatus } from "../../../../../database/enums/shop-status.enum";

export interface ShopProfileResponseDto {
  capabilities: {
    canUpdatePublicProfile: boolean;
  };
  shop: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string;
    description: string | null;
    mainCategoryId: string;
    businessModel: string;
    contactEmail: string;
    contactPhone: string;
    status: ShopStatus;
    verifiedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  tax: {
    profileType: SellerProfileType;
    legalName: string | null;
    taxCodeMasked: string | null;
    invoiceEmail: string | null;
    payoutBankName: string | null;
    payoutAccountHolder: string | null;
    payoutAccountNumberMasked: string | null;
    payoutAccountType: PayoutAccountType;
  };
  identity: {
    verificationStatus: "verified";
    profileType: SellerProfileType;
    legalName: string | null;
    citizenIdMasked: string | null;
    representativeName: string | null;
    representativeRole: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    documentTypes: string[];
    verifiedAt: Date;
  };
}
