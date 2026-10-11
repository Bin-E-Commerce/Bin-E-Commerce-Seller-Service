// Phân tích phép thay đổi và lượng tồn từ câu tự nhiên, tách khỏi I/O của inventory service để test độc lập.
import type { SellerInventoryCommand } from '@/modules/seller-copilot/application/modes/agent/types/seller-inventory-command.types';

const INVENTORY_UNIT_SUFFIX =
    /(?:\s+(?:sản\s+phẩm|sp|đơn\s+vị|đv|cái|chiếc|món(?:\s+hàng)?|nhé|nha|đi))+[.!?]*$/iu;

// Xác định đúng phép toán trước khi lấy query sản phẩm; “tăng ... lên N” là đặt target, “tăng N” là cộng thêm.
export function parseSellerInventoryCommand(
    message: string,
): SellerInventoryCommand | null {
    // Chuẩn hóa khoảng trắng và bỏ đơn vị/câu đệm ở cuối để các regex vẫn bắt được số lượng cuối câu.
    const normalized = message.trim().replace(/\s+/gu, ' ');
    const commandText = normalized.replace(INVENTORY_UNIT_SUFFIX, '');
    const increaseMatch = commandText.match(
        /(?:^|\s)(?:tăng|cộng)\s+(?:thêm\s+)?(\d+)(?!\d)/iu,
    );
    const decreaseMatch = commandText.match(
        /(?:^|\s)(?:giảm\s+(?:(?:bớt|thêm)\s+)?|trừ\s+(?:đi\s+)?)(\d+)(?!\d)/iu,
    );
    const explicitSetMatch = commandText.match(
        /(?:^|\s)(?:đặt|cập nhật|chỉnh|đưa)(?=\s).*?(?:lên|về|thành|còn|xuống|bằng)\s*(\d+)(?!\d)\s*[.!?]*$/iu,
    );
    const targetMatch = commandText.match(
        /(?:^|\s)(?:lên|về|thành|xuống|bằng)\s*(\d+)(?!\d)\s*[.!?]*$/iu,
    );
    const increaseToMatch = commandText.match(
        /(?:^|\s)tăng\s+.*?\s+lên\s*(\d+)(?!\d)\s*[.!?]*$/iu,
    );

    // Ưu tiên đích tuyệt đối trước phép cộng/trừ để không diễn giải “tăng ... lên 7” thành cộng thêm 7.
    const operationMatch =
        explicitSetMatch ??
        targetMatch ??
        decreaseMatch ??
        increaseToMatch ??
        increaseMatch;
    const quantity = Number(operationMatch?.[1]);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return null;

    // Chuyển động từ khớp thành phép toán; target tuyệt đối luôn thắng động từ “tăng” đứng trước nó.
    const operation =
        explicitSetMatch || targetMatch || increaseToMatch
            ? 'set'
            : decreaseMatch
              ? 'decrease'
              : increaseMatch
                ? 'increase'
                : null;
    if (!operation || !operationMatch) return null;

    // Chỉ xóa token số lượng đã bắt khỏi câu gốc; số trong SKU/tên sản phẩm vẫn còn để tìm đúng biến thể.
    const quantityIndex = operationMatch.index ?? -1;
    const quantityToken = operationMatch[1] ?? '';
    const quantityStart =
        quantityIndex + operationMatch[0].lastIndexOf(quantityToken);
    const withoutQuantity =
        quantityStart >= 0
            ? `${commandText.slice(0, quantityStart)} ${commandText.slice(quantityStart + quantityToken.length)}`
            : commandText;
    const commandWords = new Set([
        'tồn',
        'kho',
        'khả',
        'dụng',
        'số',
        'lượng',
        'sản',
        'phẩm',
        'đơn',
        'vị',
        'variant',
        'sku',
        'cập',
        'nhật',
        'chỉnh',
        'đưa',
        'đặt',
        'tăng',
        'giảm',
        'cộng',
        'thêm',
        'bớt',
        'trừ',
        'lên',
        'về',
        'thành',
        'còn',
        'xuống',
        'bằng',
        'hãy',
        'giúp',
        'mình',
        'tôi',
        'của',
        'nhé',
        'nha',
        'đi',
        'này',
    ]);
    const productQuery = withoutQuantity
        .replace(/@bingpt/giu, ' ')
        .replace(/^@(?:tồn-kho|ton-kho)\s*/iu, ' ')
        // Dòng insight có thể lặp tồn cũ “còn N”; xóa con số trạng thái, không xóa số định danh SKU.
        .replace(/\bcòn\s+\d+\b/giu, ' ')
        .replace(/[.,!?;:()[\]{}"“”'’]/gu, ' ')
        .split(/\s+/u)
        .filter((word) => !commandWords.has(word.toLocaleLowerCase('vi')))
        .join(' ')
        .trim();

    return { productQuery, operation, quantity };
}
