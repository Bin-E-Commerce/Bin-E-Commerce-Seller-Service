// Contract tác vụ tồn kho dùng giữa chat, proposal persistence và Product Service client.
export interface SellerCopilotInventoryProposalPayload {
    kind: 'SET_INVENTORY';
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    expectedAvailable: number;
    nextAvailable: number;
}

export interface SellerCopilotActionProposalRecord {
    id: string;
    conversationId: string;
    ownerUserId: string;
    shopId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    payload: SellerCopilotInventoryProposalPayload;
    expiresAt: Date;
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
