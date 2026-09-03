import { PayoutAccountType } from "../../../../database/shared/enums/payout-account-type.enum";
import { SellerProfileType } from "../../../../database/shared/enums/seller-profile-type.enum";
import { ShopStatus } from "../../../../database/shop-profile/enums/shop-status.enum";
import { ShopProfileChangeRequestResponseDto } from "./shop-profile-change-request-response.dto";

export interface ShopProfileResponseDto {
  capabilities: {
    canUpdatePublicProfile: boolean;
    canRequestSensitiveChange: boolean;
  };
  pendingChangeRequest: ShopProfileChangeRequestResponseDto | null;
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
    payoutBankCode: string | null;
    payoutBankName: string | null;
    payoutAccountHolder: string | null;
    payoutAccountNumberMasked: string | null;
    payoutAccountType: PayoutAccountType;
    payoutBranch: string | null;
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
