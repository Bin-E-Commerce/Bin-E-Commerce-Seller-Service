// Xác nhận proposal tồn kho một lần; Seller Service kiểm tra scope, Product Service tái xác minh quyền và trạng thái tồn.
import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type { SellerCopilotActionProposalRecord } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';

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
            const result = await this.applyProposal(
                shop,
                input,
                proposal.payload,
            );
            const message = result.message;
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
                ...(result.availableQuantity !== undefined
                    ? { availableQuantity: result.availableQuantity }
                    : {}),
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

    // Xác nhận từng proposal độc lập theo thứ tự nhận; lỗi một dòng không rollback hoặc ngăn các dòng còn lại.
    async confirmBatch(input: {
        ownerUserId: string | undefined;
        proposalIds: string[];
        email: string;
        permissions: string[];
    }) {
        const uniqueIds = [...new Set(input.proposalIds)];
        if (uniqueIds.length === 0 || uniqueIds.length > 50) {
            return uniqueIds.map((proposalId) => ({
                proposalId,
                status: 'failed' as const,
                message: 'Mỗi lượt chỉ xác nhận từ 1 đến 50 đề xuất.',
            }));
        }
        const results = [];
        for (const proposalId of uniqueIds) {
            try {
                results.push(await this.confirm({ ...input, proposalId }));
            } catch (error) {
                // Không trả chi tiết lỗi nội bộ; dòng hiện tại thất bại nhưng các proposal khác vẫn tiếp tục xử lý.
                results.push({
                    proposalId,
                    status: 'failed' as const,
                    message:
                        error instanceof Error && error.name !== 'Error'
                            ? error.message
                            : 'Không thể áp dụng đề xuất này. Hãy tạo preview mới rồi thử lại.',
                });
            }
        }
        return results;
    }

    // Seller có thể chỉnh target của một đề xuất tồn kho trước khi xác nhận; Product Service vẫn kiểm tra stale state lần cuối.
    async reviseInventoryProposal(input: {
        ownerUserId: string | undefined;
        proposalId: string;
        nextAvailable: number;
    }) {
        if (
            !Number.isSafeInteger(input.nextAvailable) ||
            input.nextAvailable < 0 ||
            input.nextAvailable > 2_147_483_647
        ) {
            throw new BadRequestException(
                'Mức tồn đề xuất phải là số nguyên không âm trong giới hạn hệ thống.',
            );
        }
        const shop = await this.access.resolveActiveShop(input.ownerUserId);
        const proposal = await this.repository.reviseInventoryProposal(
            { ownerUserId: shop.ownerUserId, shopId: shop.id },
            input.proposalId,
            input.nextAvailable,
        );
        // Repository đã kiểm tra tenant, trạng thái pending, TTL và giới hạn tồn/reserved dưới row lock.
        if (!proposal) {
            throw new NotFoundException(
                'Đề xuất không còn hợp lệ, đã hết hạn, vượt giới hạn hoặc không thuộc shop hiện tại.',
            );
        }
        // Kiểm tra lại union payload ở application boundary để chỉ trả target tồn kho cho endpoint này.
        if (proposal.payload.kind !== 'SET_INVENTORY') {
            throw new NotFoundException('Đề xuất tồn kho không còn hợp lệ.');
        }
        return {
            proposalId: proposal.id,
            nextAvailable: proposal.payload.nextAvailable,
            expiresAt: proposal.expiresAt.toISOString(),
        };
    }

    // Chỉ dispatch các payload còn được hỗ trợ; mỗi nhánh gửi expected state để Product Service phát hiện preview stale.
    // Payload cũ hoặc không nhận diện được bị từ chối thay vì đoán một thao tác ghi khác.
    private async applyProposal(
        shop: { id: string; ownerUserId: string },
        input: { email: string; permissions: string[] },
        payload: SellerCopilotActionProposalRecord['payload'],
    ): Promise<{ message: string; availableQuantity?: number }> {
        const identity = {
            shopId: shop.id,
            ownerUserId: shop.ownerUserId,
            email: input.email,
            permissions: input.permissions,
        };
        if (payload.kind === 'SET_INVENTORY') {
            const result = await this.inventoryClient.setAvailable({
                ...identity,
                variantId: payload.variantId,
                expectedAvailable: payload.expectedAvailable,
                nextAvailable: payload.nextAvailable,
            });
            return {
                message: `Đã cập nhật tồn khả dụng của ${payload.productName} — ${payload.variantName} thành ${result.available}.`,
                availableQuantity: result.available,
            };
        }
        if (payload.kind === 'SET_VARIANT_PRICE') {
            const result = await this.inventoryClient.setVariantPrice({
                ...identity,
                ...payload,
            });
            return {
                message: `Đã cập nhật giá ${payload.productName} — ${payload.variantName} thành ${result.price.toLocaleString('vi-VN')}đ.`,
            };
        }
        if (payload.kind === 'UPDATE_PRODUCT_CONTENT') {
            await this.inventoryClient.updateProductContent({
                ...identity,
                ...payload,
            });
            return {
                message: `Đã cập nhật nội dung sản phẩm ${payload.productName}.`,
            };
        }
        throw new BadRequestException(
            'Loại đề xuất này không còn được hỗ trợ.',
        );
    }
}
