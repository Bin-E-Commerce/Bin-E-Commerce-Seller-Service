import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { ShopInfoDto } from '@/modules/seller-onboarding/presentation/dto/shop-info.dto';
import { SellerInfoDto } from '@/modules/seller-onboarding/presentation/dto/seller-info.dto';
import { PickupAddressDto } from '@/modules/seller-onboarding/presentation/dto/pickup-address.dto';
import { PayoutInfoDto } from '@/modules/seller-onboarding/presentation/dto/payout-info.dto';

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
