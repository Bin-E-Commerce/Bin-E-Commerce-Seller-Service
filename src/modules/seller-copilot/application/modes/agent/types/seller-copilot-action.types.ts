// Contract proposal đóng cho các tác vụ sản phẩm; proposal là preview, không phải quyền ghi dữ liệu.
export interface SellerCopilotInventoryProposalPayload {
    kind: 'SET_INVENTORY';
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    expectedAvailable: number;
    nextAvailable: number;
    lowStockThreshold?: number;
    reserved?: number;
    recommendationReason?: 'LOW_STOCK';
}

export interface SellerCopilotLowStockProposalPayload extends SellerCopilotInventoryProposalPayload {
    kind: 'SET_INVENTORY';
    lowStockThreshold: number;
    reserved: number;
    recommendationReason: 'LOW_STOCK';
}

export interface SellerCopilotVariantPriceProposalPayload {
    kind: 'SET_VARIANT_PRICE';
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    expectedPrice: number;
    nextPrice: number;
    minimumPrice?: number;
    priceRecommendation?: {
        kind: 'SLOW_MOVING_CLEARANCE';
        available: number;
        quantitySold: number;
        periodDays: 7 | 30 | 90;
        requestedDiscountPercent: number;
        effectiveDiscountPercent: number;
    };
}

export interface SellerCopilotProductContentProposalPayload {
    kind: 'UPDATE_PRODUCT_CONTENT';
    productId: string;
    productName: string;
    expectedName?: string;
    nextName?: string;
    expectedDescription?: string | null;
    nextDescription?: string;
}

export type SellerCopilotActionProposalPayload =
    | SellerCopilotInventoryProposalPayload
    | SellerCopilotLowStockProposalPayload
    | SellerCopilotVariantPriceProposalPayload
    | SellerCopilotProductContentProposalPayload;

// Snapshot hẹp dùng đối soát sau timeout; chỉ chứa trạng thái cần so với preview đã lưu.
export interface SellerCopilotActionCurrentState {
    productId: string;
    name?: string;
    description?: string | null;
    variant?: {
        variantId: string;
        price: number;
        available: number;
    };
}

// Phân biệt thao tác đã xong, chưa đổi trạng thái, bị đổi bởi tác nhân khác hoặc chưa đọc được.
export type SellerCopilotActionStateResolution =
    | {
          status: 'applied' | 'unchanged' | 'different';
          snapshot: SellerCopilotActionCurrentState;
      }
    | { status: 'unavailable' };

export interface SellerCopilotActionProposalRecord {
    id: string;
    conversationId: string;
    ownerUserId: string;
    shopId: string;
    batchId: string | null;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    payload: SellerCopilotActionProposalPayload;
    expiresAt: Date;
    result?: Record<string, unknown> | null;
}

// Read model hẹp từ Product Service; chỉ chứa thông tin nhận diện variant và số tồn cần preview.
export interface SellerInventorySearchResult {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    sellerSku: string | null;
    available: number;
    reserved: number;
}
