// So khớp SKU và tên biến thể theo ranh giới để mã ngắn không trùng một mã dài hoặc chữ cái ngẫu nhiên trong câu.
import { normalizeSellerCommandText } from '@/modules/seller-copilot/application/modes/agent/utils/normalize-seller-command-text.util';

// SKU coi dấu chấm, gạch chéo và gạch nối là một phần mã; chỉ dấu câu bao quanh mới được làm ranh giới.
export function messageContainsExactSellerSku(
    message: string,
    sku: string,
): boolean {
    const normalizedMessage = message.normalize('NFC').toLocaleLowerCase('vi');
    const normalizedSku = sku.trim().normalize('NFC').toLocaleLowerCase('vi');
    if (!normalizedSku) return false;

    const escapedSku = normalizedSku.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const tokenBoundary = '[^\\p{L}\\p{N}._/-]';
    const exactSkuPattern = new RegExp(
        `(?:^|${tokenBoundary})${escapedSku}(?=$|${tokenBoundary})`,
        'u',
    );

    return exactSkuPattern.test(normalizedMessage);
}

// Tên biến thể phải khớp trọn cụm; size `S` không được xem là có mặt trong từ “sản phẩm”.
export function messageContainsExactSellerVariant(
    message: string,
    variantName: string,
): boolean {
    const normalizedMessage = normalizeSellerCommandText(message);
    const normalizedVariant = normalizeSellerCommandText(variantName).trim();
    if (!normalizedVariant) return false;

    const escapedVariant = normalizedVariant.replace(
        /[.*+?^${}()|[\]\\]/gu,
        '\\$&',
    );
    const phraseBoundary = '[^\\p{L}\\p{N}]';
    const exactVariantPattern = new RegExp(
        `(?:^|${phraseBoundary})${escapedVariant}(?=$|${phraseBoundary})`,
        'u',
    );

    return exactVariantPattern.test(normalizedMessage);
}
