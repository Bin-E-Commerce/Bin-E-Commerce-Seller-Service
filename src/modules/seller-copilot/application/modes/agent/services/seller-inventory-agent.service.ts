// Chuẩn bị proposal tồn kho; không ghi dữ liệu, chỉ tạo preview sau khi target và phép tính đã rõ.
import { Inject, Injectable } from '@nestjs/common';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotInventoryProposalPayload } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type { SellerInventoryTargetReference } from '@/modules/seller-copilot/application/modes/agent/types/seller-inventory-command.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import { parseSellerInventoryCommand } from '@/modules/seller-copilot/application/modes/agent/utils/parse-seller-inventory-command.util';

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
        target?: SellerInventoryTargetReference;
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
        const command = parseSellerInventoryCommand(input.message);
        if (!command) {
            return {
                kind: 'clarification',
                message:
                    'Bạn muốn đặt tồn khả dụng thành số nào, hay tăng/giảm thêm bao nhiêu sản phẩm? Hãy ghi rõ tên hoặc SKU sản phẩm nhé.',
            };
        }
        // Đại từ chỉ được dùng khi caller đã nối target từ insight trong đúng phiên; nếu không phải nêu tên/SKU.
        if (!command.productQuery && !input.target) {
            return {
                kind: 'clarification',
                message:
                    'Bạn cho mình tên sản phẩm hoặc SKU cần chỉnh tồn kho nhé.',
            };
        }

        // Target theo ngữ cảnh tìm bằng SKU rồi đối chiếu cả hai ID; không chọn một kết quả fuzzy khác nếu SKU lệch.
        const searchQuery = input.target
            ? input.target.sellerSku || input.target.sku
            : command.productQuery;
        if (!searchQuery.trim()) {
            return {
                kind: 'clarification',
                message:
                    'Biến thể vừa nhắc tới chưa có SKU để xác minh. Bạn gửi giúp mình SKU của sản phẩm nhé.',
            };
        }
        const matches = await this.searchProducts(input.shopId, searchQuery);
        const candidate = input.target
            ? (matches.find(
                  (item) =>
                      item.productId === input.target?.productId &&
                      item.variantId === input.target?.variantId,
              ) ?? null)
            : selectCandidate(matches, input.message);
        if (!candidate) {
            return {
                kind: 'clarification',
                message: input.target
                    ? 'Mình chưa xác minh được đúng biến thể vừa nhắc tới trong tồn kho hiện tại. Bạn gửi SKU hoặc tên biến thể giúp mình nhé.'
                    : matches.length
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
