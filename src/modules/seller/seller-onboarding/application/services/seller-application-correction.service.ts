import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { SellerApplicationCorrectionTarget } from "../../../../../database/enums/seller-application-correction-target.enum";

@Injectable()
export class SellerApplicationCorrectionService {
  // Chụp hash theo từng nhóm admin chọn tại đúng thời điểm từ chối để lần gửi sau có mốc so sánh ổn định.
  captureSnapshotHashes(
    application: SellerApplication,
    targets: SellerApplicationCorrectionTarget[],
  ): Partial<Record<SellerApplicationCorrectionTarget, string>> {
    return targets.reduce<
      Partial<Record<SellerApplicationCorrectionTarget, string>>
    >((hashes, target) => {
      hashes[target] = this.hashValue(this.readTargetValue(application, target));
      return hashes;
    }, {});
  }

  // Trả về các nhóm vẫn giống snapshot bị từ chối; mọi nhóm được yêu cầu đều phải thay đổi mới được gửi lại.
  getUnchangedTargets(
    application: SellerApplication,
  ): SellerApplicationCorrectionTarget[] {
    return (application.correctionTargets ?? []).filter((target) => {
      const rejectedHash = application.correctionSnapshotHashes?.[target];
      if (!rejectedHash) return true;

      const currentHash = this.hashValue(
        this.readTargetValue(application, target),
      );
      return currentHash === rejectedHash;
    });
  }

  // Chỉ gom field thuộc đúng bounded group để thay đổi địa chỉ không thể vô tình thỏa yêu cầu sửa giấy tờ hoặc thanh toán.
  private readTargetValue(
    application: SellerApplication,
    target: SellerApplicationCorrectionTarget,
  ): unknown {
    switch (target) {
      case SellerApplicationCorrectionTarget.SHOP_INFORMATION:
        return {
          name: application.shopName,
          slug: application.shopSlug,
          mainCategoryId: application.mainCategoryId,
          businessModel: application.businessModel,
          description: application.shopDescription,
        };
      case SellerApplicationCorrectionTarget.SHOP_LOGO:
        return { logoUrl: application.logoUrl };
      case SellerApplicationCorrectionTarget.SELLER_IDENTITY:
        return {
          profileType: application.profileType,
          legalName: application.legalName,
          citizenId: application.citizenId,
          taxCode: application.taxCode,
          representativeName: application.representativeName,
          representativeRole: application.representativeRole,
          phone: application.contactPhone,
          email: application.contactEmail,
        };
      case SellerApplicationCorrectionTarget.VERIFICATION_DOCUMENTS:
        return application.verificationDocuments;
      case SellerApplicationCorrectionTarget.PICKUP_ADDRESS:
        return {
          contactName: application.pickupContactName,
          phone: application.pickupPhone,
          provinceId: application.pickupProvinceId,
          wardId: application.pickupWardId,
          addressLine: application.pickupAddressLine,
        };
      case SellerApplicationCorrectionTarget.PAYOUT_INFORMATION:
        return {
          bankCode: application.bankCode,
          bankName: application.bankName,
          accountNumber: application.bankAccountNumber,
          accountHolderName: application.bankAccountHolderName,
          accountType: application.bankAccountType,
          branch: application.bankBranch,
        };
    }
  }

  // Canonical JSON sắp xếp key đệ quy để hai object cùng dữ liệu luôn sinh cùng hash dù thứ tự thuộc tính khác nhau.
  private hashValue(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(this.sortForStableHash(value)))
      .digest("hex");
  }

  // Chuẩn hóa array/object trước khi hash; primitive và null được giữ nguyên để không làm sai nghĩa dữ liệu nghiệp vụ.
  private sortForStableHash(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortForStableHash(item));
    }

    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = this.sortForStableHash(
            (value as Record<string, unknown>)[key],
          );
          return result;
        }, {});
    }

    return value;
  }
}
