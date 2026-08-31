import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ShopPickupAddress } from "../../../../../database/entities/shop-pickup-address.entity";
import { ShopShippingSettings } from "../../../../../database/entities/shop-shipping-settings.entity";
import { SellerApplication } from "../../../../../database/entities/seller-application.entity";
import { Shop } from "../../../../../database/entities/shop.entity";
import { ShopUserContext } from "../types/shop-user-context.type";
import { ShopOwnershipService } from "./shop-ownership.service";
import { ShopProfileAccessService } from "./shop-profile-access.service";
import { ProductCatalogClient } from "../clients/product-catalog.client";
import type {
  SavePickupAddressDto,
  UpdateShopShippingSettingsDto,
} from "../../presentation/dto/shop-shipping.dto";

// Response đầy đủ cho Seller UI và contract nội bộ lấy pickup address.
export interface ShopShippingSettingsResponse {
  settings: ShopShippingSettings;
  pickupAddresses: ShopPickupAddress[];
}

export type ShopShippingReadinessReason =
  | "READY"
  | "NO_PICKUP_ADDRESS"
  | "NO_DEFAULT_PICKUP_ADDRESS"
  | "INCOMPLETE_PICKUP_ADDRESS"
  | "SHIPPING_DISABLED";

export interface ShopShippingReadinessResponse {
  ready: boolean;
  reason: ShopShippingReadinessReason;
}

// Use case quản lý địa chỉ lấy hàng và cấu hình vận chuyển hiện tại.
@Injectable()
export class ShopShippingSettingsService {
  constructor(
    @InjectRepository(ShopPickupAddress)
    private readonly addressRepository: Repository<ShopPickupAddress>,
    @InjectRepository(ShopShippingSettings)
    private readonly settingsRepository: Repository<ShopShippingSettings>,
    @InjectRepository(SellerApplication)
    private readonly applicationRepository: Repository<SellerApplication>,
    @InjectRepository(Shop) private readonly shopRepository: Repository<Shop>,
    private readonly ownership: ShopOwnershipService,
    private readonly access: ShopProfileAccessService,
    private readonly productCatalog: ProductCatalogClient,
  ) {}

  // Đọc settings theo shop của user hiện tại và tự tạo record mặc định cho shop cũ.
  async getMine(
    currentUser: ShopUserContext,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureRead(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const settings = await this.ensureSettings(shop.id);
    const pickupAddresses = await this.ensureOnboardingPickupAddress(
      shop,
      settings,
    );
    return { settings, pickupAddresses };
  }

  // Cập nhật thời gian vận hành và không cho xóa default address đang được dùng.
  async updateSettings(
    currentUser: ShopUserContext,
    dto: UpdateShopShippingSettingsDto,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureManage(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const settings = await this.ensureSettings(shop.id);
    if (dto.defaultPickupAddressId !== undefined) {
      if (
        dto.defaultPickupAddressId &&
        !(await this.addressRepository.findOne({
          where: { id: dto.defaultPickupAddressId, shopId: shop.id },
        }))
      ) {
        throw new BadRequestException(
          "Địa chỉ lấy hàng không thuộc shop hiện tại.",
        );
      }
      settings.defaultPickupAddressId = dto.defaultPickupAddressId;
    }
    Object.assign(settings, {
      preparationTimeHours:
        dto.preparationTimeHours ?? settings.preparationTimeHours,
      pickupWindowStart: dto.pickupWindowStart ?? settings.pickupWindowStart,
      pickupWindowEnd: dto.pickupWindowEnd ?? settings.pickupWindowEnd,
      enabled: dto.enabled ?? settings.enabled,
    });
    await this.settingsRepository.save(settings);
    return this.getMine(user);
  }

  // Thêm pickup address và chọn default nếu shop chưa có địa chỉ nào.
  async createAddress(
    currentUser: ShopUserContext,
    dto: SavePickupAddressDto,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureManage(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const settings = await this.ensureSettings(shop.id);
    const hasAddress = await this.addressRepository.exists({
      where: { shopId: shop.id },
    });
    const address = await this.addressRepository.save(
      this.addressRepository.create({
        shopId: shop.id,
        contactName: dto.contactName,
        phone: dto.phone,
        ghnProvinceId: dto.provinceId,
        ghnProvinceName: dto.provinceName,
        ghnDistrictId: dto.districtId,
        ghnDistrictName: dto.districtName,
        ghnWardCode: dto.wardCode,
        ghnWardName: dto.wardName,
        addressLine: dto.addressLine,
        isDefault: !hasAddress,
      }),
    );
    settings.onboardingAddressSynced = true;
    // Nếu settings còn trỏ tới bản ghi đã xóa, địa chỉ mới phải nhận vai trò mặc định để shop không rơi vào trạng thái không thể đăng bán.
    const configuredDefault = settings.defaultPickupAddressId
      ? await this.addressRepository.findOne({
          where: { id: settings.defaultPickupAddressId, shopId: shop.id },
        })
      : null;
    if (!configuredDefault) {
      settings.defaultPickupAddressId = address.id;
    }
    await this.settingsRepository.save(settings);
    return this.getMine(user);
  }

  // Cập nhật địa chỉ thuộc shop hiện tại.
  async updateAddress(
    currentUser: ShopUserContext,
    addressId: string,
    dto: SavePickupAddressDto,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureManage(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const address = await this.addressRepository.findOne({
      where: { id: addressId, shopId: shop.id },
    });
    if (!address)
      throw new NotFoundException("Không tìm thấy địa chỉ lấy hàng.");
    Object.assign(address, {
      contactName: dto.contactName,
      phone: dto.phone,
      ghnProvinceId: dto.provinceId,
      ghnProvinceName: dto.provinceName,
      ghnDistrictId: dto.districtId,
      ghnDistrictName: dto.districtName,
      ghnWardCode: dto.wardCode,
      ghnWardName: dto.wardName,
      addressLine: dto.addressLine,
    });
    await this.addressRepository.save(address);
    return this.getMine(user);
  }

  // Xóa địa chỉ thuộc shop hiện tại trong transaction để settings không trỏ vào bản ghi đã bị xóa.
  // Nếu địa chỉ bị xóa là mặc định, địa chỉ cũ nhất còn lại sẽ được chọn thay thế; shop không còn địa chỉ thì default được đặt null.
  async deleteAddress(
    currentUser: ShopUserContext,
    addressId: string,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureManage(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);

    const settings = await this.ensureSettings(shop.id);
    const address = await this.addressRepository.findOne({
      where: { id: addressId, shopId: shop.id },
    });
    if (!address)
      throw new NotFoundException("Không tìm thấy địa chỉ lấy hàng.");

    const isDefault =
      settings.defaultPickupAddressId === address.id || address.isDefault;
    if (isDefault) {
      // Fail-closed: không xóa địa chỉ mặc định khi Product Service chưa xác minh được shop còn sản phẩm ACTIVE hay không.
      const activeProductCount =
        await this.productCatalog.getActiveProductCount(shop.id);
      if (activeProductCount > 0) {
        throw new ConflictException({
          code: "ACTIVE_PRODUCTS_REQUIRE_PICKUP_ADDRESS",
          message:
            "Không thể xóa địa chỉ mặc định khi shop còn sản phẩm đang đăng bán.",
          action: "SET_ANOTHER_DEFAULT_ADDRESS",
        });
      }
    }

    await this.addressRepository.manager.transaction(async (manager) => {
      const addressRepository = manager.getRepository(ShopPickupAddress);
      const settingsRepository = manager.getRepository(ShopShippingSettings);
      const address = await addressRepository.findOne({
        where: { id: addressId, shopId: shop.id },
      });

      if (!address)
        throw new NotFoundException("Không tìm thấy địa chỉ lấy hàng.");

      await addressRepository.delete({ id: address.id, shopId: shop.id });
      const settings = await settingsRepository.findOne({
        where: { shopId: shop.id },
      });

      if (!settings) return;

      // Đánh dấu shop đã chủ động quản lý kho để lần đọc tiếp theo không tự khôi phục địa chỉ onboarding vừa bị xóa.
      settings.onboardingAddressSynced = true;
      if (settings.defaultPickupAddressId !== address.id) {
        await settingsRepository.save(settings);
        return;
      }

      const replacement = await addressRepository.findOne({
        where: { shopId: shop.id },
        order: { createdAt: "ASC" },
      });
      settings.defaultPickupAddressId = replacement?.id ?? null;
      if (replacement) {
        replacement.isDefault = true;
        await addressRepository.save(replacement);
      }
      await settingsRepository.save(settings);
    });

    return this.getMine(user);
  }

  // Đặt default atomically ở phạm vi shop và trả settings mới.
  async setDefault(
    currentUser: ShopUserContext,
    addressId: string,
  ): Promise<ShopShippingSettingsResponse> {
    const user = this.ensureManage(currentUser);
    const shop = await this.ownership.findOwnedShopOrThrow(user.userId);
    const address = await this.addressRepository.findOne({
      where: { id: addressId, shopId: shop.id },
    });
    if (!address)
      throw new NotFoundException("Không tìm thấy địa chỉ lấy hàng.");
    await this.addressRepository.update(
      { shopId: shop.id },
      { isDefault: false },
    );
    address.isDefault = true;
    await this.addressRepository.save(address);
    const settings = await this.ensureSettings(shop.id);
    settings.onboardingAddressSynced = true;
    settings.defaultPickupAddressId = address.id;
    await this.settingsRepository.save(settings);
    return this.getMine(user);
  }

  // Internal contract cho Order/Shipping lấy pickup address theo shop đã xác thực ở upstream.
  async getDefaultForShop(shopId: string): Promise<ShopPickupAddress> {
    const shop = await this.shopRepository.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("KhÃ´ng tÃ¬m tháº¥y shop.");
    const settings = await this.ensureSettings(shopId);
    const addresses = await this.ensureOnboardingPickupAddress(shop, settings);
    // Ưu tiên khóa mặc định trong settings nhưng vẫn fallback sang cờ isDefault để tự phục hồi dữ liệu legacy bị lệch hai nguồn.
    const address =
      (settings.defaultPickupAddressId
        ? await this.addressRepository.findOne({
            where: { id: settings.defaultPickupAddressId, shopId },
          })
        : null) ?? addresses.find((item) => item.isDefault) ?? null;
    if (!address)
      throw new BadRequestException(
        "Shop chưa cấu hình địa chỉ lấy hàng mặc định.",
      );
    return address;
  }

  // Kiểm tra đầy đủ điều kiện giao nhận để Product Service chặn việc đăng bán thiếu nơi lấy hàng.
  // GHN cần district ID và ward code để tính phí, nên readiness phải chặn địa chỉ thiếu quận/huyện.
  async getReadinessForShop(
    shopId: string,
  ): Promise<ShopShippingReadinessResponse> {
    const shop = await this.shopRepository.findOne({ where: { id: shopId } });
    if (!shop) throw new NotFoundException("Không tìm thấy shop.");

    const settings = await this.ensureSettings(shopId);
    const pickupAddresses = await this.ensureOnboardingPickupAddress(
      shop,
      settings,
    );
    if (pickupAddresses.length === 0) {
      return {
        ready: false,
        reason: "NO_PICKUP_ADDRESS",
      };
    }

    if (!settings.enabled) {
      return {
        ready: false,
        reason: "SHIPPING_DISABLED",
      };
    }

    // Fallback sang isDefault giúp readiness không bị sai khi settings chưa được đồng bộ với bản ghi địa chỉ legacy.
    const defaultAddress =
      pickupAddresses.find(
        (address) => address.id === settings.defaultPickupAddressId,
      ) ?? pickupAddresses.find((address) => address.isDefault);

    if (!defaultAddress) {
      return {
        ready: false,
        reason: "NO_DEFAULT_PICKUP_ADDRESS",
      };
    }

    const hasCompleteAddress = Boolean(
      defaultAddress.contactName.trim() &&
      defaultAddress.phone.trim() &&
      defaultAddress.ghnProvinceId &&
      defaultAddress.ghnProvinceName?.trim() &&
      defaultAddress.ghnDistrictId &&
      defaultAddress.ghnDistrictName?.trim() &&
      defaultAddress.ghnWardCode &&
      defaultAddress.ghnWardName?.trim() &&
      defaultAddress.addressLine.trim(),
    );

    if (!hasCompleteAddress) {
      return {
        ready: false,
        reason: "INCOMPLETE_PICKUP_ADDRESS",
      };
    }

    return { ready: true, reason: "READY" };
  }

  // Đảm bảo shop cũ có cấu hình mặc định mà không tự tạo địa chỉ thiếu dữ liệu.
  private async ensureSettings(shopId: string): Promise<ShopShippingSettings> {
    const existing = await this.settingsRepository.findOne({
      where: { shopId },
    });
    if (existing) return existing;
    return this.settingsRepository.save(
      this.settingsRepository.create({
        shopId,
        defaultPickupAddressId: null,
        preparationTimeHours: 24,
        pickupWindowStart: "08:00",
        pickupWindowEnd: "18:00",
        enabled: true,
      }),
    );
  }

  // Tự động chuyển địa chỉ đã được Seller khai báo trong hồ sơ duyệt thành pickup address vận hành.
  // Luồng này chỉ chạy khi shop chưa có kho nào, nên không ghi đè địa chỉ seller đã tự quản lý.
  // Dữ liệu onboarding cũ có thể thiếu quận/huyện; giữ null để readiness buộc Seller bổ sung thay vì bịa mã địa giới.
  private async ensureOnboardingPickupAddress(
    shop: Shop,
    settings: ShopShippingSettings,
  ): Promise<ShopPickupAddress[]> {
    const existing = await this.addressRepository.find({
      where: { shopId: shop.id },
      order: { isDefault: "DESC", createdAt: "ASC" },
    });

    if (existing.length > 0) {
      if (!settings.onboardingAddressSynced) {
        settings.onboardingAddressSynced = true;
        await this.settingsRepository.save(settings);
      }
      return existing;
    }

    // Không tự tạo lại địa chỉ sau khi Seller đã chủ động xóa kho; Seller có thể nhập địa chỉ mới bên dưới.
    if (settings.onboardingAddressSynced) return existing;

    const application = await this.applicationRepository.findOne({
      where: { id: shop.sellerApplicationId },
    });
    const pickup = application
      ? {
          contactName: application.pickupContactName?.trim(),
          phone: application.pickupPhone?.trim(),
          ghnProvinceId: application.pickupGhnProvinceId,
          ghnProvinceName: application.pickupGhnProvinceName,
          ghnDistrictId: application.pickupGhnDistrictId,
          ghnDistrictName: application.pickupGhnDistrictName,
          ghnWardCode: application.pickupGhnWardCode,
          ghnWardName: application.pickupGhnWardName,
          addressLine: application.pickupAddressLine?.trim(),
        }
      : null;

    if (
      !pickup?.contactName ||
      !pickup.phone ||
      !pickup.ghnProvinceId ||
      !pickup.ghnProvinceName?.trim() ||
      !pickup.ghnDistrictId ||
      !pickup.ghnDistrictName?.trim() ||
      !pickup.ghnWardCode ||
      !pickup.ghnWardName?.trim() ||
      !pickup.addressLine
    ) {
      return existing;
    }

    const address = await this.addressRepository.save(
      this.addressRepository.create({
        shopId: shop.id,
        contactName: pickup.contactName,
        phone: pickup.phone,
        ghnProvinceId: pickup.ghnProvinceId,
        ghnProvinceName: pickup.ghnProvinceName!,
        ghnDistrictId: pickup.ghnDistrictId,
        ghnDistrictName: pickup.ghnDistrictName!,
        ghnWardCode: pickup.ghnWardCode,
        ghnWardName: pickup.ghnWardName!,
        addressLine: pickup.addressLine,
        isDefault: true,
      }),
    );

    settings.defaultPickupAddressId = address.id;
    settings.onboardingAddressSynced = true;
    await this.settingsRepository.save(settings);

    return [address];
  }

  // Guard đọc riêng để nhân viên có quyền read không vô tình sửa cấu hình.
  private ensureRead(currentUser: ShopUserContext): ShopUserContext {
    if (!currentUser.userId || !currentUser.email)
      throw new BadRequestException("Thiếu user context.");
    if (
      !currentUser.permissions.includes("seller.shipping.settings.read") &&
      !currentUser.permissions.includes("seller.shipping.settings.manage")
    )
      throw new BadRequestException(
        "Bạn không có quyền xem thiết lập giao nhận.",
      );
    return currentUser;
  }

  // Guard ghi riêng và vẫn chạy sau Gateway để bảo vệ khi service bị gọi trực tiếp.
  private ensureManage(currentUser: ShopUserContext): ShopUserContext {
    if (!currentUser.userId || !currentUser.email)
      throw new BadRequestException("Thiếu user context.");
    if (!currentUser.permissions.includes("seller.shipping.settings.manage"))
      throw new BadRequestException(
        "Bạn không có quyền chỉnh sửa thiết lập giao nhận.",
      );
    return currentUser;
  }
}
