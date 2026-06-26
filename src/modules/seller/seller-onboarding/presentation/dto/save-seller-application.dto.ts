import { Type } from "class-transformer";
import { IsBoolean, IsOptional, ValidateNested } from "class-validator";
import { ShopInfoDto } from "./shop-info.dto";
import { SellerInfoDto } from "./seller-info.dto";
import { PickupAddressDto } from "./pickup-address.dto";
import { PayoutInfoDto } from "./payout-info.dto";

export class SaveSellerApplicationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ShopInfoDto)
  shop?: ShopInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SellerInfoDto)
  seller?: SellerInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PickupAddressDto)
  pickupAddress?: PickupAddressDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayoutInfoDto)
  payout?: PayoutInfoDto;

  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;
}
