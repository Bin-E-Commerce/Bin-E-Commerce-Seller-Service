// Chuẩn bị proposal tồn kho; không ghi dữ liệu, chỉ tạo preview sau khi target và phép tính đã rõ.
import { Inject, Injectable } from '@nestjs/common';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotInventoryProposalPayload } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

const PROPOSAL_TTL_MS = 10 * 60 * 1000;

// Tác vụ tồn kho chỉ dựng preview có thời hạn; mọi ghi dữ liệu phải đi qua use case xác nhận riêng.
// Service sở hữu cách hiểu lệnh seller và ràng buộc proposal với owner/shop/conversation.
@Injectable()
export class SellerInventoryAgentService {
    constructor(
        private readonly inventoryClient: SellerInventoryAgentClient,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Tìm các variant để trả lời câu hỏi tồn kho; đây là read-only và không tạo proposal hay thay đổi dữ liệu.
    async searchProducts(shopId: string, query: string) {
        // Truy vấn quá ngắn dễ match rộng và lộ danh sách không liên quan; chỉ gọi Product Service khi có tín hiệu nhận diện tối thiểu.
        if (query.trim().length < 2) return [];
        return this.inventoryClient.search(shopId, query);
    }

    // Catalog read-only phục vụ liệt kê/chi tiết; truyền đồng thời shop và owner đã xác thực để giữ cả record legacy hợp lệ.
    async getProductCatalog(
        shopId: string,
        ownerUserId: string,
    ): Promise<SellerCopilotProductCatalogSnapshot> {
        return this.inventoryClient.getProductCatalog(shopId, ownerUserId);
    }

    // Đọc rõ phép toán và đối tượng trước khi gọi Product Service; nếu thiếu một trong hai thì hỏi lại, không phỏng đoán.
    // Candidate chỉ được tự chọn khi SKU/variant xác định duy nhất; sau đó kiểm tra số âm/overflow trước khi tạo proposal.
    // Proposal lưu expected stock và hết hạn sau 10 phút; method này tuyệt đối không gọi API ghi tồn.
    async prepare(input: {
        ownerUserId: string;
        shopId: string;
        conversationId: string;
        message: string;
    }): Promise<
        | { kind: 'clarification'; message: string }
        | {
              kind: 'proposal';
              proposalId: string;
              payload: SellerCopilotInventoryProposalPayload;
              expiresAt: Date;
          }
    > {
        // Parser phải xác định rõ cả phép toán lẫn số lượng; nếu không, tuyệt đối không suy ra một giá trị mặc định để ghi.
        const command = parseInventoryCommand(input.message);
        if (!command) {
            return {
                kind: 'clarification',
                message:
                    'Bạn muốn đặt tồn khả dụng thành số nào, hay tăng/giảm thêm bao nhiêu sản phẩm? Hãy ghi rõ tên hoặc SKU sản phẩm nhé.',
            };
        }
        // Tách riêng trường hợp thiếu đối tượng để yêu cầu người bán bổ sung SKU/tên thay vì tìm kiếm toàn catalog.
        if (!command.productQuery) {
            return {
                kind: 'clarification',
                message:
                    'Bạn cho mình tên sản phẩm hoặc SKU cần chỉnh tồn kho nhé.',
            };
        }

        // Chỉ dùng kết quả tìm kiếm từ shop đã resolve; lựa chọn mơ hồ được chuyển thành câu hỏi xác nhận, không chọn top hit.
        const matches = await this.searchProducts(
            input.shopId,
            command.productQuery,
        );
        const candidate = selectCandidate(matches, input.message);
        if (!candidate) {
            return {
                kind: 'clarification',
                message: matches.length
                    ? `Mình tìm thấy nhiều sản phẩm/biến thể phù hợp:\n${matches
                          .slice(0, 5)
                          .map(
                              (item, index) =>
                                  `${index + 1}. ${item.productName} — ${item.variantName} (SKU ${item.sellerSku ?? item.sku}, còn ${item.available})`,
                          )
                          .join(
                              '\n',
                          )}\nBạn chọn đúng biến thể hoặc gửi SKU giúp mình nhé.`
                    : 'Mình chưa tìm thấy sản phẩm phù hợp trong shop. Bạn kiểm tra tên sản phẩm hoặc gửi SKU nhé.',
            };
        }

        // Các phép toán dùng available hiện tại từ Product Service; reserved không được cộng vào available nhưng phải xét giới hạn DB.
        const nextAvailable =
            command.operation === 'increase'
                ? candidate.available + command.quantity
                : command.operation === 'decrease'
                  ? candidate.available - command.quantity
                  : command.quantity;
        // Giới hạn từng giá trị khả dụng trước, sau đó kiểm tra tổng available + reserved theo giới hạn cột lưu trữ.
        // PostgreSQL inventory dùng integer 32-bit; chặn overflow trước khi proposal được lưu hoặc gửi đi.
        if (nextAvailable > 2_147_483_647) {
            return {
                kind: 'clarification',
                message:
                    'Số tồn vượt giới hạn hệ thống hỗ trợ. Bạn nhập số nhỏ hơn nhé.',
            };
        }
        if (nextAvailable + candidate.reserved > 2_147_483_647) {
            return {
                kind: 'clarification',
                message:
                    'Số tồn mới cộng với số lượng đang giữ vượt giới hạn hệ thống hỗ trợ.',
            };
        }
        if (nextAvailable < 0) {
            return {
                kind: 'clarification',
                message: `Biến thể hiện chỉ còn ${candidate.available} sản phẩm khả dụng nên không thể giảm thêm ${command.quantity}. Bạn kiểm tra lại số lượng nhé.`,
            };
        }

        // Lưu snapshot expected cùng proposal có TTL; thao tác này chỉ ghi yêu cầu chờ xác nhận, chưa gọi endpoint cập nhật.
        const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
        const payload: SellerCopilotInventoryProposalPayload = {
            kind: 'SET_INVENTORY',
            productId: candidate.productId,
            productName: candidate.productName,
            variantId: candidate.variantId,
            variantName: candidate.variantName,
            expectedAvailable: candidate.available,
            nextAvailable,
        };
        const proposal = await this.repository.createActionProposal({
            conversationId: input.conversationId,
            ownerUserId: input.ownerUserId,
            shopId: input.shopId,
            payload,
            expiresAt,
        });

        return {
            kind: 'proposal',
            proposalId: proposal.id,
            payload,
            expiresAt,
        };
    }
}

// Tách quantity khỏi phần nhận diện sản phẩm và chỉ chấp nhận phép tính có nghĩa rõ ràng trong câu seller.
function parseInventoryCommand(message: string): {
    productQuery: string;
    operation: 'set' | 'increase' | 'decrease';
    quantity: number;
} | null {
    // Giữ nguyên chuỗi gốc để số nằm trong SKU/tên vẫn có thể được dùng nhận diện sau khi tách quantity.
    const normalized = message.trim();
    // Tách loại thao tác theo cụm động từ rõ nghĩa; không dựa vào một con số đứng riêng vì có thể là mã sản phẩm.
    const increaseMatch = normalized.match(
        /(?:^|\s)(?:tăng|cộng)\s+(?:thêm\s+)?(\d+)(?!\d)/iu,
    );
    const decreaseMatch = normalized.match(
        /(?:^|\s)(?:giảm\s+(?:(?:bớt|thêm)\s+)?|trừ\s+(?:đi\s+)?)(\d+)(?!\d)/iu,
    );
    const explicitSetMatch = normalized.match(
        /(?:^|\s)(?:đặt|cập nhật|chỉnh|đưa)(?=\s).*?(?:lên|về|thành|còn|xuống|bằng)\s*(\d+)(?!\d)/iu,
    );
    // Match ưu tiên phép tăng/giảm trước set; nếu không có một trong ba cấu trúc được hỗ trợ thì từ chối phân tích.
    const operationMatch = increaseMatch ?? decreaseMatch ?? explicitSetMatch;
    // Number phải là safe integer và không âm; token thiếu/overflow trả null để use case hỏi lại.
    const parsedQuantity = Number(operationMatch?.[1]);
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 0)
        return null;

    // Operation khớp với nhóm regex đã bắt; nhánh cuối bảo vệ trường hợp parser bị sửa nhưng match không nhất quán.
    let operation: 'set' | 'increase' | 'decrease';
    if (increaseMatch) {
        operation = 'increase';
    } else if (decreaseMatch) {
        operation = 'decrease';
    } else if (explicitSetMatch) {
        operation = 'set';
    } else {
        return null;
    }

    // Chỉ bỏ số lượng đã gắn với động từ thao tác; các chữ số còn lại như SKU/mã sản phẩm phải được giữ để định danh.
    // Chỉ xóa đúng token quantity đã match; các số còn lại vẫn thuộc tên/SKU và phải sống sót trong productQuery.
    const quantityIndex = operationMatch?.index ?? -1;
    const quantityToken = operationMatch?.[1] ?? '';
    const quantityStart =
        quantityIndex + operationMatch?.[0].lastIndexOf(quantityToken)!;
    const withoutQuantity =
        quantityStart >= 0
            ? `${normalized.slice(0, quantityStart)} ${normalized.slice(quantityStart + quantityToken.length)}`
            : normalized;
    // Bỏ từ mệnh lệnh/ngữ pháp để phần còn lại dùng làm query; allowlist này không xóa chữ số hoặc token định danh.
    const commandWords = new Set([
        'tồn',
        'kho',
        'khả',
        'dụng',
        'số',
        'lượng',
        'sản',
        'phẩm',
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
        'giúp',
        'mình',
        'tôi',
        'nhé',
        'nha',
        'đi',
    ]);
    const productQuery = withoutQuantity
        .replace(/@bingpt/giu, ' ')
        .replace(/[.,!?;:()[\]{}]/gu, ' ')
        .split(/\s+/u)
        .filter((word) => !commandWords.has(word.toLocaleLowerCase('vi')))
        .join(' ')
        .trim();

    return {
        productQuery,
        operation,
        quantity: parsedQuantity,
    };
}

// Chỉ tự chọn khi có đúng một kết quả hoặc một SKU khớp nguyên văn; tên sản phẩm chung với nhiều variant phải hỏi lại.
function selectCandidate<
    T extends {
        productName: string;
        variantName: string;
        sku: string;
        sellerSku: string | null;
    },
>(matches: T[], message: string): T | null {
    // Một kết quả duy nhất không mơ hồ; nhiều kết quả thì yêu cầu phải chứa SKU chính xác hoặc tên biến thể duy nhất.
    if (matches.length === 1) return matches[0] ?? null;
    const normalized = message.toLocaleLowerCase('vi');
    // Chỉ nhận SKU duy nhất; nhiều SKU cùng xuất hiện hoặc SKU không khớp nguyên văn sẽ đi tiếp để thử variant.
    const exactSkuMatches = matches.filter((item) =>
        [item.sku, item.sellerSku]
            .filter((sku): sku is string => Boolean(sku))
            .some((sku) => normalized.includes(sku.toLocaleLowerCase('vi'))),
    );
    // Chỉ trả SKU khi có một candidate; nếu SKU xuất hiện trong nhiều kết quả thì chưa đủ để xác định variant.
    if (exactSkuMatches.length === 1) return exactSkuMatches[0] ?? null;
    // Tên variant có thể trùng giữa sản phẩm; chỉ một match mới đủ an toàn để tạo proposal.
    const exactVariantMatches = matches.filter((item) =>
        normalized.includes(item.variantName.toLocaleLowerCase('vi')),
    );
    // Tên variant trùng hoặc không khớp đều yêu cầu làm rõ để không tạo proposal trên sản phẩm sai.
    return exactVariantMatches.length === 1
        ? (exactVariantMatches[0] ?? null)
        : null;
}
