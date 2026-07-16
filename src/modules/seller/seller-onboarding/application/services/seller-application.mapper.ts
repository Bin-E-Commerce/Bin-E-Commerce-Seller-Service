import { Injectable } from "@nestjs/common";
import { PayoutAccountType } from "../../../../../database/enums/payout-account-type.enum";
import { SellerProfileType } from "../../../../../database/enums/seller-profile-type.enum";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { SaveSellerApplicationDto } from "../../presentation/dto/save-seller-application.dto";
import { SellerApplicationResponseDto } from "../../presentation/dto/seller-application-response.dto";
import { toNullableString } from "../utils/seller-application-string.util";

@Injectable()
export class SellerApplicationMapper {
  // Áp từng section DTO vào whitelist field của entity; status, review và audit field không bao giờ được nhận từ FE.
  // Mỗi section có mặt được xem là snapshot mới của bước đó, còn section không gửi lên được giữ nguyên.
  applyDto(
    application: SellerApplication,
    dto: SaveSellerApplicationDto,
  ): void {
    // Thông tin nhận diện shop được lưu riêng với dữ liệu pháp lý để các bước onboarding có thể lưu độc lập.
    if (dto.shop) {
      application.shopName = toNullableString(dto.shop.name);
      application.shopSlug = toNullableString(dto.shop.slug);
      application.mainCategoryId = toNullableString(dto.shop.mainCategoryId);
      application.businessModel = toNullableString(dto.shop.businessModel);
      application.shopDescription = toNullableString(dto.shop.description);
      application.logoUrl = toNullableString(dto.shop.logoUrl);
    }

    // Khi user đổi loại hồ sơ, xóa mã định danh của loại cũ để không lưu đồng thời CCCD và mã số thuế trái nghiệp vụ.
    if (dto.seller) {
      const profileType = dto.seller.profileType ?? SellerProfileType.INDIVIDUAL;
      application.profileType = profileType;
      application.legalName = toNullableString(dto.seller.legalName);
      application.citizenId =
        profileType === SellerProfileType.INDIVIDUAL
          ? toNullableString(dto.seller.citizenId)
          : null;
      application.taxCode =
        profileType === SellerProfileType.BUSINESS
          ? toNullableString(dto.seller.taxCode)
          : null;
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

    // Chỉ lưu ID master data; tên tỉnh/phường được location-service quản lý và tra cứu khi cần hiển thị.
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

    // Payout mới là dữ liệu khai báo chờ đối soát, chưa phải tài khoản thanh toán đã được xác minh.
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

  // Chuyển entity sang response contract theo đúng các section của form để FE khôi phục nháp mà không phụ thuộc tên cột DB.
  toResponse(application: SellerApplication): SellerApplicationResponseDto {
    return {
      id: application.id,
      userId: application.userId,
      userEmail: application.userEmail,
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
