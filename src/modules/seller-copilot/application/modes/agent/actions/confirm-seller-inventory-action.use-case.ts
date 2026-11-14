// Xác nhận proposal tồn kho một lần; Seller Service kiểm tra scope, Product Service tái xác minh quyền và trạng thái tồn.
import {
    BadRequestException,
    ConflictException,
    HttpException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type {
    SellerCopilotActionCurrentState,
    SellerCopilotActionProposalRecord,
    SellerCopilotActionStateResolution,
} from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';

// Xác nhận proposal trong đúng owner/shop scope đã xác thực.
// Proposal đang xử lý có thể được tiếp tục sau timeout; compare-and-set của Product Service ngăn ghi lặp.
// Khi response downstream mơ hồ, đọc lại đúng sản phẩm để hoàn tất, giữ pending cho lần thử tiếp hoặc báo xung đột.
@Injectable()
export class ConfirmSellerInventoryActionUseCase {
    constructor(
        private readonly access: SellerCopilotAccessService,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
        private readonly inventoryClient: SellerInventoryAgentClient,
    ) {}

    // Đọc shop từ identity tin cậy trước khi consume proposal và không suy quyền từ proposalId.
    // Nếu proposal đã ở trạng thái processing, đọc trạng thái hiện tại để phục hồi kết quả hoặc chạy lại cùng compare-and-set.
    // Lỗi transport giữ proposal có thể thử lại; lỗi nghiệp vụ rõ ràng kết thúc thất bại và mọi phản hồi mơ hồ không báo thành công.
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
        // Repository khóa proposal trong tenant; processing có thể được tiếp tục vì mọi mutation đều so expected state.
        const proposal = await this.repository.consumeActionProposal(
            scope,
            input.proposalId,
        );
        if (!proposal) {
            throw new NotFoundException(
                'Đề xuất đã hết hạn, đã được xác nhận hoặc không thuộc shop hiện tại.',
            );
        }
        if (proposal.status === 'completed' || proposal.status === 'failed') {
            // Retry sau khi client mất response trả lại kết quả terminal đã lưu, không gọi mutation lần nữa.
            return {
                proposalId: proposal.id,
                status: proposal.status,
                message:
                    typeof proposal.result?.message === 'string'
                        ? proposal.result.message
                        : proposal.status === 'completed'
                          ? 'Đề xuất này đã được áp dụng trước đó.'
                          : 'Đề xuất này đã thất bại trước đó. Hãy tạo preview mới để thử lại.',
                ...(typeof proposal.result?.availableQuantity === 'number'
                    ? {
                          availableQuantity: proposal.result.availableQuantity,
                      }
                    : {}),
            };
        }

        if (proposal.status === 'processing') {
            // Sau crash, trạng thái đích chứng minh lần trước đã ghi; trạng thái gốc cho phép tiếp tục CAS an toàn.
            const currentState = await this.readProposalState(
                shop,
                proposal,
            ).catch(() => ({ status: 'unavailable' as const }));
            if (currentState.status === 'applied') {
                return this.completeAsApplied(
                    scope,
                    proposal,
                    currentState.snapshot,
                );
            }
            if (currentState.status === 'different') {
                const conflict = new ConflictException(
                    'Dữ liệu đã thay đổi sau khi xem trước. Hãy kiểm tra trạng thái hiện tại rồi tạo đề xuất mới.',
                );
                if (!(await this.completeAsFailed(scope, proposal, conflict))) {
                    return this.buildProcessingResult(proposal.id);
                }
                throw conflict;
            }
        }

        let result: { message: string; availableQuantity?: number };
        try {
            // Product Service so expected value trong transaction; hai request cùng proposal không thể cùng ghi target khác nhau.
            result = await this.applyProposal(shop, input, proposal.payload);
        } catch (error) {
            // Timeout/409 có thể là response bị mất sau khi ghi; đọc lại snapshot phân biệt đã áp dụng với xung đột thật.
            const currentState = await this.readProposalState(
                shop,
                proposal,
            ).catch(() => ({ status: 'unavailable' as const }));
            if (currentState.status === 'applied') {
                return this.completeAsApplied(
                    scope,
                    proposal,
                    currentState.snapshot,
                );
            }

            const isDefinitiveClientError =
                error instanceof HttpException &&
                error.getStatus() < 500 &&
                !(error instanceof ConflictException);
            if (
                isDefinitiveClientError ||
                currentState.status === 'different' ||
                (error instanceof ConflictException &&
                    currentState.status === 'unchanged')
            ) {
                const failure =
                    currentState.status === 'different'
                        ? new ConflictException(
                              'Dữ liệu đã thay đổi sau khi xem trước. Hãy kiểm tra trạng thái hiện tại rồi tạo đề xuất mới.',
                          )
                        : error;
                if (!(await this.completeAsFailed(scope, proposal, failure))) {
                    return this.buildProcessingResult(proposal.id);
                }
                throw failure;
            }

            // Chưa chứng minh được kết quả nên giữ processing để lần xác nhận kế tiếp đối soát cùng proposalId.
            // UI hiện nút kiểm tra lại; Product Service compare-and-set sẽ chặn việc ghi đè ngoài preview.
            return this.buildProcessingResult(proposal.id);
        }

        // Chỉ ghi completed sau khi downstream xác nhận mutation; lỗi DB để proposal processing cho lần đối soát kế tiếp.
        try {
            const completed = await this.repository.completeActionProposal(
                scope,
                proposal.id,
                'completed',
                { ...result, message: result.message },
            );
            if (completed === false) {
                return this.buildProcessingResult(proposal.id);
            }
        } catch {
            // Ghi product đã được xác nhận; giữ processing để retry đọc trạng thái đích và lưu lại kết quả terminal.
            return this.buildProcessingResult(proposal.id);
        }
        return {
            proposalId: proposal.id,
            status: 'completed' as const,
            message: result.message,
            ...(result.availableQuantity !== undefined
                ? { availableQuantity: result.availableQuantity }
                : {}),
        };
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
                // Chỉ lỗi HTTP nghiệp vụ 4xx có thông báo được kiểm soát mới lộ ra; exception nội bộ dùng thông báo chung.
                results.push({
                    proposalId,
                    status: 'failed' as const,
                    message:
                        error instanceof HttpException &&
                        error.getStatus() < 500
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

    // Đối chiếu snapshot với giá trị trước/sau; lỗi đọc được biểu diễn riêng để không kết luận sai khi service chưa phản hồi.
    private async readProposalState(
        shop: { id: string; ownerUserId: string },
        proposal: SellerCopilotActionProposalRecord,
    ): Promise<SellerCopilotActionStateResolution> {
        const payload = proposal.payload;
        const snapshot = await this.inventoryClient.getCurrentActionState({
            shopId: shop.id,
            ownerUserId: shop.ownerUserId,
            productId: payload.productId,
            ...('variantId' in payload ? { variantId: payload.variantId } : {}),
        });
        if (!snapshot) return { status: 'unavailable' };

        if (payload.kind === 'SET_INVENTORY') {
            const available = snapshot.variant?.available;
            if (available === undefined) return { status: 'unavailable' };
            if (available === payload.nextAvailable) {
                return { status: 'applied', snapshot };
            }
            return {
                status:
                    available === payload.expectedAvailable
                        ? 'unchanged'
                        : 'different',
                snapshot,
            };
        }

        if (payload.kind === 'SET_VARIANT_PRICE') {
            const price = snapshot.variant?.price;
            if (price === undefined) return { status: 'unavailable' };
            if (price === payload.nextPrice) {
                return { status: 'applied', snapshot };
            }
            return {
                status:
                    price === payload.expectedPrice ? 'unchanged' : 'different',
                snapshot,
            };
        }

        const name = snapshot.name;
        const description = snapshot.description;
        if (name === undefined || description === undefined) {
            return { status: 'unavailable' };
        }
        const targetMatches =
            (payload.nextName === undefined || name === payload.nextName) &&
            (payload.nextDescription === undefined ||
                description === payload.nextDescription);
        if (targetMatches) return { status: 'applied', snapshot };
        const expectedMatches =
            (payload.expectedName === undefined ||
                name === payload.expectedName) &&
            (payload.expectedDescription === undefined ||
                description === payload.expectedDescription);
        return {
            status: expectedMatches ? 'unchanged' : 'different',
            snapshot,
        };
    }

    // Ghi một kết quả đã được snapshot xác nhận; phương thức giữ cùng message/result contract với đường thành công thông thường.
    private async completeAsApplied(
        scope: { ownerUserId: string; shopId: string },
        proposal: SellerCopilotActionProposalRecord,
        snapshot: SellerCopilotActionCurrentState,
    ) {
        const payload = proposal.payload;
        const message =
            payload.kind === 'SET_INVENTORY'
                ? `Đã xác minh tồn khả dụng của ${payload.productName} — ${payload.variantName} là ${snapshot.variant?.available}.`
                : payload.kind === 'SET_VARIANT_PRICE'
                  ? `Đã xác minh giá ${payload.productName} — ${payload.variantName} là ${snapshot.variant?.price?.toLocaleString('vi-VN')}đ.`
                  : `Đã xác minh nội dung sản phẩm ${payload.productName} đã được cập nhật.`;
        const result = {
            message,
            reconciled: true,
            ...(payload.kind === 'SET_INVENTORY'
                ? { availableQuantity: snapshot.variant?.available }
                : {}),
        };

        try {
            const completed = await this.repository.completeActionProposal(
                scope,
                proposal.id,
                'completed',
                result,
            );
            if (completed === false) {
                return this.buildProcessingResult(proposal.id);
            }
        } catch {
            // Kết quả đã được đối soát nhưng chưa lưu được; retry sẽ đọc lại cùng target thay vì báo hoàn tất sớm.
            return this.buildProcessingResult(proposal.id);
        }
        return {
            proposalId: proposal.id,
            status: 'completed' as const,
            ...result,
        };
    }

    // Chỉ đóng proposal khi trạng thái hiện tại đã chứng minh thao tác thất bại; giữ error name để log/audit nội bộ.
    private async completeAsFailed(
        scope: { ownerUserId: string; shopId: string },
        proposal: SellerCopilotActionProposalRecord,
        error: unknown,
    ): Promise<boolean> {
        try {
            return await this.repository.completeActionProposal(
                scope,
                proposal.id,
                'failed',
                {
                    errorType:
                        error instanceof Error ? error.name : 'unknown_error',
                    message:
                        error instanceof HttpException &&
                        error.getStatus() < 500
                            ? error.message
                            : 'Không thể áp dụng đề xuất này. Hãy tạo preview mới rồi thử lại.',
                },
            );
        } catch {
            // Không báo terminal khi DB chưa xác nhận; proposal processing vẫn có thể được đối soát ở lần sau.
            return false;
        }
    }

    // Phản hồi processing giữ nguyên proposalId để browser có thể retry an toàn sau lỗi mạng hoặc lỗi lưu trạng thái.
    private buildProcessingResult(proposalId: string) {
        return {
            proposalId,
            status: 'processing' as const,
            message:
                'Chưa xác minh được kết quả cập nhật. Đề xuất vẫn được giữ an toàn; hãy bấm kiểm tra lại trước khi tạo yêu cầu mới.',
        };
    }
}
