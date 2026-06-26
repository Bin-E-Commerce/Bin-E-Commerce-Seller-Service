import { Injectable } from "@nestjs/common";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { toNullableString } from "../utils/seller-application-string.util";

@Injectable()
export class SellerApplicationMapper {
  // Áp dữ liệu DTO vào entity theo từng nhóm để tránh body từ FE ghi thẳng vào field nhạy cảm.
  applyDto(
    application: SellerApplication,
    dto: SaveSellerApplicationDto,
  ): void {
    if (dto.shop) {
      application.shopName = toNullableString(dto.shop.name);
      application.shopSlug = toNullableString(dto.shop.slug);
      application.mainCategoryId = toNullableString(dto.shop.mainCategoryId);
      application.businessModel = toNullableString(dto.shop.businessModel);
      application.shopDescription = toNullableString(dto.shop.description);
      application.logoUrl = toNullableString(dto.shop.logoUrl);
    }

    if (dto.seller) {
      application.profileType =
        dto.seller.profileType ?? SellerProfileType.INDIVIDUAL;
      application.legalName = toNullableString(dto.seller.legalName);
      application.citizenId = toNullableString(dto.seller.citizenId);
      application.taxCode = toNullableString(dto.seller.taxCode);
      application.representativeName = toNullableString(
        dto.seller.representativeName,
      );
      application.representativeRole = toNullableString(
        dto.seller.representativeRole,
      );
      application.contactPhone = toNullableString(dto.seller.phone);
      application.contactEmail = toNullableString(dto.seller.email);
      application.verificationDocuments = dto.seller.documents ?? {};
    }

    if (dto.pickupAddress) {
      application.pickupContactName = toNullableString(
        dto.pickupAddress.contactName,
      );
      application.pickupPhone = toNullableString(dto.pickupAddress.phone);
      application.pickupProvinceId = toNullableString(
        dto.pickupAddress.provinceId,
      );
      application.pickupWardId = toNullableString(dto.pickupAddress.wardId);
      application.pickupAddressLine = toNullableString(
        dto.pickupAddress.addressLine,
      );
    }

    if (dto.payout) {
      application.bankCode = toNullableString(dto.payout.bankCode);
      application.bankName = toNullableString(dto.payout.bankName);
      application.bankAccountNumber = toNullableString(
        dto.payout.accountNumber,
      );
      application.bankAccountHolderName = toNullableString(
        dto.payout.accountHolderName,
      );
      application.bankAccountType =
        dto.payout.accountType ?? PayoutAccountType.PERSONAL;
      application.bankBranch = toNullableString(dto.payout.branch);
    }
  }

  // Chuyển entity sang response contract để FE không phụ thuộc cấu trúc bảng.
  toResponse(application: SellerApplication): SellerApplicationResponseDto {
    return {
      id: application.id,
      status: application.status,
      submittedAt: application.submittedAt,
      reviewedAt: application.reviewedAt,
      reviewNote: application.reviewNote,
      shop: {
        name: application.shopName,
        slug: application.shopSlug,
        mainCategoryId: application.mainCategoryId,
        businessModel: application.businessModel,
        description: application.shopDescription,
        logoUrl: application.logoUrl,
      },
      seller: {
        profileType: application.profileType,
        legalName: application.legalName,
        citizenId: application.citizenId,
        taxCode: application.taxCode,
        representativeName: application.representativeName,
        representativeRole: application.representativeRole,
        phone: application.contactPhone,
        email: application.contactEmail,
        documents: application.verificationDocuments,
      },
      pickupAddress: {
        contactName: application.pickupContactName,
        phone: application.pickupPhone,
        provinceId: application.pickupProvinceId,
        wardId: application.pickupWardId,
        addressLine: application.pickupAddressLine,
      },
      payout: {
        bankCode: application.bankCode,
        bankName: application.bankName,
        accountNumber: application.bankAccountNumber,
        accountHolderName: application.bankAccountHolderName,
        accountType: application.bankAccountType,
        branch: application.bankBranch,
      },
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    };
  }
}
