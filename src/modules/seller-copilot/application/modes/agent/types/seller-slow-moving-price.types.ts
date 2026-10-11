// Contract tiêu chí xả hàng; các giá trị này chỉ tạo preview và không thay thế xác nhận của seller.
export interface SellerSlowMovingPriceCriteria {
    minimumAvailable: number;
    maximumQuantitySold: number;
    periodDays: 7 | 30 | 90;
    discountPercent: number;
    minimumPrice: number;
}

export interface SellerSlowMovingPriceCandidate {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    sellerSku: string | null;
    available: number;
    quantitySold: number;
    expectedPrice: number;
    nextPrice: number;
    effectiveDiscountPercent: number;
}
