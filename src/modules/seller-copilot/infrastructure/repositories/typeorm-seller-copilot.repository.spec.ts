// Unit test cho transaction xóa Seller Copilot; không kết nối PostgreSQL thật.
// Test kiểm tra scope, thứ tự dọn feedback và command xóa conversation để cascade messages được database thực hiện.
import { DataSource } from 'typeorm';
import { SellerCopilotConversation } from '@/database/seller-copilot/entities/seller-copilot-conversation.entity';
import { TypeOrmSellerCopilotRepository } from '@/modules/seller-copilot/infrastructure/repositories/typeorm-seller-copilot.repository';

describe('TypeOrmSellerCopilotRepository.deleteConversation', () => {
    let target: TypeOrmSellerCopilotRepository;
    let conversationRepository: {
        findOne: jest.Mock;
        delete: jest.Mock;
    };
    let feedbackQueryBuilder: {
        delete: jest.Mock;
        where: jest.Mock;
        execute: jest.Mock;
    };
    let feedbackRepository: {
        createQueryBuilder: jest.Mock;
    };
    let dataSource: DataSource;

    beforeEach(() => {
        conversationRepository = {
            findOne: jest.fn().mockResolvedValue({ id: 'conversation-1' }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        feedbackQueryBuilder = {
            delete: jest.fn(),
            where: jest.fn(),
            execute: jest.fn().mockResolvedValue({ affected: 1 }),
        };
        feedbackQueryBuilder.delete.mockReturnValue(feedbackQueryBuilder);
        feedbackQueryBuilder.where.mockReturnValue(feedbackQueryBuilder);
        feedbackRepository = {
            createQueryBuilder: jest.fn().mockReturnValue(feedbackQueryBuilder),
        };
        const manager = {
            getRepository: jest.fn((entity: unknown) =>
                entity === SellerCopilotConversation
                    ? conversationRepository
                    : feedbackRepository,
            ),
        };
        dataSource = {
            transaction: jest.fn(async (callback) => callback(manager)),
        } as unknown as DataSource;
        target = new TypeOrmSellerCopilotRepository(
            conversationRepository as never,
            {} as never,
            feedbackRepository as never,
            dataSource,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // Transaction phải dọn feedback theo message trước rồi mới xóa conversation trong đúng scope.
    it('cleans feedback and deletes a scoped conversation', async () => {
        const scope = { ownerUserId: 'owner-1', shopId: 'shop-1' };

        const result = await target.deleteConversation(scope, 'conversation-1');

        expect(result).toBe(true);
        expect(conversationRepository.findOne).toHaveBeenCalledWith({
            where: { ...scope, id: 'conversation-1' },
            select: { id: true },
        });
        expect(feedbackQueryBuilder.where).toHaveBeenCalledWith(
            'message_id IN (SELECT id FROM seller_copilot_messages WHERE conversation_id = :conversationId)',
            { conversationId: 'conversation-1' },
        );
        expect(feedbackQueryBuilder.execute).toHaveBeenCalledTimes(1);
        expect(conversationRepository.delete).toHaveBeenCalledWith({
            ...scope,
            id: 'conversation-1',
        });
    });

    // Conversation ngoài scope phải dừng transaction trước khi đụng feedback hoặc conversation khác.
    it('does not delete an out-of-scope conversation', async () => {
        conversationRepository.findOne.mockResolvedValue(null);

        const result = await target.deleteConversation(
            { ownerUserId: 'owner-1', shopId: 'shop-1' },
            'other-conversation',
        );

        expect(result).toBe(false);
        expect(feedbackRepository.createQueryBuilder).not.toHaveBeenCalled();
        expect(conversationRepository.delete).not.toHaveBeenCalled();
    });
});
