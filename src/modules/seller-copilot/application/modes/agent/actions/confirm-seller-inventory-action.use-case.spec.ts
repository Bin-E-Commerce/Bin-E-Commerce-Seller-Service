// Kiểm tra xác nhận một lần và scope user/shop trước khi tác vụ chạm Product Service.
import { NotFoundException } from '@nestjs/common';
import type { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import { ConfirmSellerInventoryActionUseCase } from '@/modules/seller-copilot/application/modes/agent/actions/confirm-seller-inventory-action.use-case';

describe('ConfirmSellerInventoryActionUseCase', () => {
    let access: { resolveActiveShop: jest.Mock };
    let repository: {
        consumeActionProposal: jest.Mock;
        completeActionProposal: jest.Mock;
        reviseInventoryProposal: jest.Mock;
    };
    let client: { setAvailable: jest.Mock };
    let target: ConfirmSellerInventoryActionUseCase;
    const proposal = {
        id: 'proposal-1',
        conversationId: 'conversation-1',
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        status: 'pending' as const,
        payload: {
            kind: 'SET_INVENTORY' as const,
            productId: 'product-1',
            productName: 'Áo xanh',
            variantId: 'variant-1',
            variantName: 'M',
            expectedAvailable: 8,
            nextAvailable: 12,
        },
        expiresAt: new Date(Date.now() + 60_000),
    };

    // Mỗi test tạo fake mới để khẳng định external write chỉ xảy ra sau khi proposal được consume thành công.
    beforeEach(() => {
        access = {
            resolveActiveShop: jest.fn().mockResolvedValue({
                id: 'shop-1',
                ownerUserId: 'owner-1',
            }),
        };
        repository = {
            consumeActionProposal: jest.fn().mockResolvedValue(proposal),
            completeActionProposal: jest.fn().mockResolvedValue(undefined),
            reviseInventoryProposal: jest.fn().mockResolvedValue(proposal),
        };
        client = {
            setAvailable: jest.fn().mockResolvedValue({
                variantId: 'variant-1',
                available: 12,
                reserved: 2,
            }),
        };
        target = new ConfirmSellerInventoryActionUseCase(
            access as unknown as SellerCopilotAccessService,
            repository as unknown as SellerCopilotRepositoryPort,
            client as unknown as SellerInventoryAgentClient,
        );
    });

    // Product Service nhận identity lấy từ request đã xác thực cùng expected stock để chống shop khác và stale write.
    it('rechecks the scoped proposal then records Product Service result', async () => {
        const result = await target.confirm({
            ownerUserId: 'owner-1',
            proposalId: 'proposal-1',
            email: 'seller@example.test',
            permissions: ['product:update'],
        });

        expect(repository.consumeActionProposal).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'proposal-1',
        );
        expect(client.setAvailable).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerUserId: 'owner-1',
                shopId: 'shop-1',
                expectedAvailable: 8,
                nextAvailable: 12,
            }),
        );
        expect(repository.completeActionProposal).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'proposal-1',
            'completed',
            expect.objectContaining({ availableQuantity: 12 }),
        );
        expect(result).toMatchObject({
            status: 'completed',
            availableQuantity: 12,
        });
    });

    // Không tồn tại, hết hạn hoặc đã dùng proposal đều phải chặn trước external write.
    it('rejects a consumed or unscoped proposal without calling Product Service', async () => {
        repository.consumeActionProposal.mockResolvedValue(null);

        await expect(
            target.confirm({
                ownerUserId: 'owner-1',
                proposalId: 'proposal-1',
                email: 'seller@example.test',
                permissions: ['product:update'],
            }),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(client.setAvailable).not.toHaveBeenCalled();
        expect(repository.completeActionProposal).not.toHaveBeenCalled();
    });

    // Direct SKU proposals không mang LOW_STOCK reason nhưng vẫn phải cho seller sửa mức tồn trước khi xác nhận.
    it('revises the target on a direct inventory proposal in the authenticated shop', async () => {
        repository.reviseInventoryProposal.mockResolvedValue({
            ...proposal,
            payload: { ...proposal.payload, nextAvailable: 20 },
        });
        const result = await target.reviseInventoryProposal({
            ownerUserId: 'owner-1',
            proposalId: 'proposal-1',
            nextAvailable: 20,
        });

        expect(repository.reviseInventoryProposal).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'proposal-1',
            20,
        );
        expect(result).toMatchObject({
            proposalId: 'proposal-1',
            nextAvailable: 20,
        });
    });

    // Từ chối input sai trước khi đọc shop/repository để API không lưu target âm, lẻ hoặc vượt integer 32-bit.
    it('rejects an invalid revised target before repository access', async () => {
        await expect(
            target.reviseInventoryProposal({
                ownerUserId: 'owner-1',
                proposalId: 'proposal-1',
                nextAvailable: 1.5,
            }),
        ).rejects.toThrow(
            'Mức tồn đề xuất phải là số nguyên không âm trong giới hạn hệ thống.',
        );

        expect(repository.reviseInventoryProposal).not.toHaveBeenCalled();
        expect(access.resolveActiveShop).not.toHaveBeenCalled();
    });
});
