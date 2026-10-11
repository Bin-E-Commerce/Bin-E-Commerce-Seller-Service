// Contract nội bộ của lệnh tồn kho và target được nối từ insight shop đã lưu.
// Target này chỉ được tạo từ metadata assistant thuộc đúng mode session, không nhận trực tiếp từ request browser.
export interface SellerInventoryCommand {
    productQuery: string;
    operation: 'set' | 'increase' | 'decrease';
    quantity: number;
}

export interface SellerInventoryTargetReference {
    productId: string;
    productName: string;
    variantId: string;
    variantName: string;
    sku: string;
    sellerSku: string | null;
}

export type SellerInventoryFollowUpResolution =
    | { kind: 'not_applicable' }
    | {
          kind: 'resolved';
          target: SellerInventoryTargetReference;
      }
    | { kind: 'clarification'; message: string };
