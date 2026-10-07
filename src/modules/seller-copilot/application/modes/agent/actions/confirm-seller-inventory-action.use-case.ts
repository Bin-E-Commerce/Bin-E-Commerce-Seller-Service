// Xác nhận proposal tồn kho một lần; Seller Service kiểm tra scope, Product Service tái xác minh quyền và trạng thái tồn.
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';

// Xác nhận tồn kho một lần trong đúng owner/shop scope đã xác thực.
// Use case không tính lại lệnh từ câu chat: nó chỉ áp proposal đã lưu và giao Product Service kiểm tra tồn hiện tại.
// Nếu downstream lỗi, proposal chuyển trạng thái terminal để seller phải tạo preview mới thay vì replay lệnh cũ.
@Injectable()
export class ConfirmSellerInventoryActionUseCase {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
        private readonly inventoryClient: SellerInventoryAgentClient,
    ) {}

    // Đọc shop từ identity trusted rồi consume proposal trong đúng tenant trước khi gọi Product Service.
    // Consume nguyên tử chặn double-click/replay; Product Service còn so expectedAvailable để từ chối preview đã stale.
    // Kết quả thành công được ghi lại vào proposal/message; lỗi chuyển proposal sang failed để ID cũ không bị replay.
    // Timeout có thể xảy ra sau khi Product Service đã ghi nhưng trước khi nhận response; hiện trạng thái này chưa phân biệt được “không ghi” với “chưa rõ kết quả”.
    async confirm(input: {
        ownerUserId: string | undefined;
        proposalId: string;
        email: string;
        permissions: string[];
    }) {
        // Identity được resolve thành owner/shop canonical trước mọi truy cập proposal; proposalId không tự chứng minh quyền.
        const shop = await this.access.resolveActiveShop(input.ownerUserId);
        const scope = {
            ownerUserId: shop.ownerUserId,
            shopId: shop.id,
        };
        // Consume là thao tác nguyên tử và một lần: null bao gồm sai tenant, hết hạn hoặc đã được xử lý, nên không gọi downstream.
        const proposal = await this.repository.consumeActionProposal(
            scope,
            input.proposalId,
        );
        if (!proposal) {
            throw new NotFoundException(
                'Đề xuất đã hết hạn, đã được xác nhận hoặc không thuộc shop hiện tại.',
            );
        }

        try {
            // Gửi expectedAvailable cùng giá trị mới để Product Service từ chối nếu tồn đã đổi kể từ lúc seller xem preview.
            const result = await this.inventoryClient.setAvailable({
                shopId: shop.id,
                ownerUserId: shop.ownerUserId,
                email: input.email,
                permissions: input.permissions,
                variantId: proposal.payload.variantId,
                expectedAvailable: proposal.payload.expectedAvailable,
                nextAvailable: proposal.payload.nextAvailable,
            });
            const message = `Đã cập nhật tồn khả dụng của ${proposal.payload.productName} — ${proposal.payload.variantName} thành ${result.available}.`;
            // Chỉ đánh dấu completed sau khi downstream xác nhận đã ghi; lưu cả kết quả để lần đọc sau phản ánh cùng kết quả.
            await this.repository.completeActionProposal(
                scope,
                proposal.id,
                'completed',
                { ...result, message },
            );
            return {
                proposalId: proposal.id,
                status: 'completed' as const,
                message,
                availableQuantity: result.available,
            };
        } catch (error) {
            // Proposal đã bị consume nên mọi lỗi đều kết thúc trạng thái ID này; seller phải tạo preview mới, không replay mù.
            // Lỗi được ném lại nguyên trạng để HTTP boundary giữ đúng semantics (ví dụ 409 khi số tồn stale).
            await this.repository.completeActionProposal(
                scope,
                proposal.id,
                'failed',
                {
                    errorType:
                        error instanceof Error ? error.name : 'unknown_error',
                },
            );
            throw error;
        }
    }
}
