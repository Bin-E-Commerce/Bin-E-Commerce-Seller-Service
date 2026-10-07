import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopStatus } from '@/database/shop-profile/enums/shop-status.enum';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { ConversationPersistenceService } from '@/modules/seller-copilot/application/conversation/persistence/conversation-persistence.service';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';

// Unit test cho command conversation; không khởi tạo database, OpenAI hoặc Qdrant thật.
describe('ConversationPersistenceService', () => {
    const repository = {
        renameConversation: jest.fn(),
    } as unknown as SellerCopilotRepositoryPort;
    const ownership = {
        findOwnedShop: jest.fn().mockResolvedValue({
            id: 'shop-1',
            ownerUserId: 'owner-1',
            name: 'Bin Né',
            status: ShopStatus.ACTIVE,
        }),
    };
    const access = new SellerCopilotAccessService(ownership as never);
    const service = new ConversationPersistenceService(access, repository);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Đảm bảo title được chuẩn hóa trước khi repository ghi và không làm mất trạng thái conversation hiện có.
    it('renames a scoped conversation with a normalized title', async () => {
        const conversation = {
            id: 'conversation-1',
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            title: 'Tên mới',
            isPinned: true,
            pinnedAt: new Date('2026-09-29T00:00:00.000Z'),
            createdAt: new Date('2026-09-28T00:00:00.000Z'),
            updatedAt: new Date('2026-09-29T00:00:00.000Z'),
        };
        repository.renameConversation = jest
            .fn()
            .mockResolvedValue(conversation);

        await expect(
            service.renameConversation(
                'owner-1',
                'conversation-1',
                '  Tên   mới  ',
            ),
        ).resolves.toBe(conversation);
        expect(repository.renameConversation).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'conversation-1',
            'Tên mới',
        );
    });

    // Conversation không thuộc shop hiện tại phải bị coi như không tồn tại để không làm lộ tenant boundary.
    it('rejects a conversation outside the active shop scope', async () => {
        repository.renameConversation = jest.fn().mockResolvedValue(null);

        await expect(
            service.renameConversation(
                'owner-1',
                'other-conversation',
                'Tên mới',
            ),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    // Không cho title rỗng hoặc vượt giới hạn database đi vào repository.
    it.each(['   ', '123456789012345678901234567890123'])(
        'rejects invalid title %j',
        async (title) => {
            await expect(
                service.renameConversation('owner-1', 'conversation-1', title),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(repository.renameConversation).not.toHaveBeenCalled();
        },
    );

    // Chỉ xóa conversation sau khi service đã resolve đúng owner/shop scope từ identity hiện tại.
    it('deletes a scoped conversation', async () => {
        repository.deleteConversation = jest.fn().mockResolvedValue(true);

        await expect(
            service.deleteConversation('owner-1', 'conversation-1'),
        ).resolves.toBeUndefined();

        expect(repository.deleteConversation).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'conversation-1',
        );
        expect(repository.deleteConversation).toHaveBeenCalledTimes(1);
    });

    // Conversation khác owner/shop phải trả NotFound để không làm lộ sự tồn tại của tenant khác.
    it('rejects deleting a conversation outside the active shop scope', async () => {
        repository.deleteConversation = jest.fn().mockResolvedValue(false);

        await expect(
            service.deleteConversation('owner-1', 'other-conversation'),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(repository.deleteConversation).toHaveBeenCalledWith(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'other-conversation',
        );
    });
});
