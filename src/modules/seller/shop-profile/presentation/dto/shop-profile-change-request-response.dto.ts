import { ShopProfileChangeRequestStatus } from "../../../../../database/enums/shop-profile-change-request-status.enum";
import { ShopProfileChangeSection } from "../../../../../database/enums/shop-profile-change-section.enum";
import {
  ShopProfileCurrentSnapshot,
  ShopProfileRequestedChanges,
} from "../../application/types/shop-profile-change.type";

export interface ShopProfileChangeRequestResponseDto {
  id: string;
  shop: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string;
  };
  requesterUserId: string;
  sections: ShopProfileChangeSection[];
  currentSnapshot: ShopProfileCurrentSnapshot;
  requestedChanges: ShopProfileRequestedChanges;
  baseComplianceVersion: number;
  requestNote: string;
  status: ShopProfileChangeRequestStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListShopProfileChangeRequestsResponseDto {
  items: ShopProfileChangeRequestResponseDto[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}
