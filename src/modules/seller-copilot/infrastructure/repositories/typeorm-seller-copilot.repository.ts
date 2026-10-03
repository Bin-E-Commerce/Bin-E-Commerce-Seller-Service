// Adapter TypeORM của Seller Copilot; toàn bộ query, join, pagination và mapping persistence nằm ở đây.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { SellerCopilotConversation } from '@/database/seller-copilot/entities/seller-copilot-conversation.entity';
import { SellerCopilotFeedback } from '@/database/seller-copilot/entities/seller-copilot-feedback.entity';
import { SellerCopilotMessage } from '@/database/seller-copilot/entities/seller-copilot-message.entity';
import type {
    SellerCopilotConversationRecord,
    SellerCopilotFeedbackRecord,
    SellerCopilotMessageRecord,
    SellerCopilotRepositoryPort,
    SellerCopilotScope,
    SellerCopilotSearchResult,
} from '@/modules/seller-copilot/application/shared/ports/seller-copilot-repository.port';

// Adapter này cô lập tên cột/schema TypeORM khỏi use case Seller Copilot.
@Injectable()
export class TypeOrmSellerCopilotRepository implements SellerCopilotRepositoryPort {
    constructor(
        @InjectRepository(SellerCopilotConversation)
        private readonly conversationRepository: Repository<SellerCopilotConversation>,
        @InjectRepository(SellerCopilotMessage)
        private readonly messageRepository: Repository<SellerCopilotMessage>,
        @InjectRepository(SellerCopilotFeedback)
        private readonly feedbackRepository: Repository<SellerCopilotFeedback>,
        private readonly dataSource: DataSource,
    ) {}

    async saveMessage(input: {
        conversationId: string;
        role: 'user' | 'assistant';
        content: string;
    }): Promise<void> {
        await this.messageRepository.save(input);
    }

    async listConversations(
        scope: SellerCopilotScope,
        offset: number,
        limit: number,
    ): Promise<{
        items: SellerCopilotConversationRecord[];
        total: number;
    }> {
        const [items, total] = await this.conversationRepository.findAndCount({
            where: scope,
            order: {
                isPinned: 'DESC',
                pinnedAt: 'DESC',
                updatedAt: 'DESC',
                id: 'DESC',
            },
            skip: offset,
            take: limit,
        });

        return { items, total };
    }

    async searchConversations(
        scope: SellerCopilotScope,
        query: string,
    ): Promise<SellerCopilotSearchResult[]> {
        const pattern = `%${query}%`;
        const rows = await this.messageRepository
            .createQueryBuilder('message')
            .innerJoin(
                SellerCopilotConversation,
                'conversation',
                'conversation.id = message.conversation_id',
            )
            .select('conversation.id', 'conversationId')
            .addSelect('conversation.title', 'title')
            .addSelect('conversation.updatedAt', 'updatedAt')
            .addSelect(
                `LEFT(
                    CASE
                        WHEN conversation.title ILIKE :pattern THEN conversation.title
                        ELSE message.content
                    END,
                    180
                )`,
                'snippet',
            )
            .addSelect(
                `CASE
                    WHEN conversation.title ILIKE :pattern THEN 'title'
                    ELSE message.role
                END`,
                'matchedIn',
            )
            .where('conversation.ownerUserId = :ownerUserId', {
                ownerUserId: scope.ownerUserId,
            })
            .andWhere('conversation.shopId = :shopId', {
                shopId: scope.shopId,
            })
            .andWhere(
                new Brackets((builder) =>
                    builder
                        .where('conversation.title ILIKE :pattern')
                        .orWhere('message.content ILIKE :pattern'),
                ),
            )
            .setParameter('pattern', pattern)
            .orderBy('conversation.updatedAt', 'DESC')
            .addOrderBy('message.createdAt', 'DESC')
            .take(100)
            .getRawMany<SellerCopilotSearchResult>();

        const uniqueResults = new Map<string, SellerCopilotSearchResult>();
        for (const row of rows) {
            if (uniqueResults.has(row.conversationId)) continue;
            uniqueResults.set(row.conversationId, row);
            if (uniqueResults.size === 20) break;
        }

        return Array.from(uniqueResults.values());
    }

    async findConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<SellerCopilotConversationRecord | null> {
        // Chỉ tìm conversation trong scope đã xác định; không reveal thông tin conversation cho tenant khác.
        return this.conversationRepository.findOne({
            where: { ...scope, id: conversationId },
        });
    }

    async createConversation(input: {
        ownerUserId: string;
        shopId: string;
        title: string;
    }): Promise<SellerCopilotConversationRecord> {
        // Lý do save + create: create() chỉ tạo entity mới nhưng chưa lưu vào database; save() sẽ insert entity vào database và trả về entity đã lưu với id và timestamps.
        return this.conversationRepository.save(
            this.conversationRepository.create(input),
        );
    }

    // Cập nhật trạng thái ghim sau khi scope đã được gắn với owner/shop; trả null nếu conversation không thuộc seller hiện tại.
    // pinnedAt chỉ thay đổi khi pin/unpin, nên việc chat cập nhật updatedAt không làm đảo thứ tự nhóm Đã ghim.
    async setConversationPinned(
        scope: SellerCopilotScope,
        conversationId: string,
        isPinned: boolean,
    ): Promise<SellerCopilotConversationRecord | null> {
        const conversation = await this.conversationRepository.findOne({
            where: { ...scope, id: conversationId },
        });
        if (!conversation) return null;

        conversation.isPinned = isPinned;
        conversation.pinnedAt = isPinned ? new Date() : null;
        return this.conversationRepository.save(conversation);
    }

    // Cập nhật title sau khi scope đã được gắn với owner/shop; không đụng vào pin state hoặc message của conversation.
    async renameConversation(
        scope: SellerCopilotScope,
        conversationId: string,
        title: string,
    ): Promise<SellerCopilotConversationRecord | null> {
        const conversation = await this.conversationRepository.findOne({
            where: { ...scope, id: conversationId },
        });
        if (!conversation) return null;

        conversation.title = title;
        return this.conversationRepository.save(conversation);
    }

    // Xóa toàn bộ dữ liệu thuộc conversation trong một transaction; scope được áp dụng trước khi xóa để không thể dùng ID của shop khác.
    // Feedback không có foreign key cascade nên phải dọn bằng subquery trước, còn messages đã có ON DELETE CASCADE từ conversation.
    async deleteConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<boolean> {
        return this.dataSource.transaction(async (manager) => {
            const conversationRepository = manager.getRepository(
                SellerCopilotConversation,
            );
            const conversation = await conversationRepository.findOne({
                where: { ...scope, id: conversationId },
                select: { id: true },
            });
            if (!conversation) return false;

            await manager
                .getRepository(SellerCopilotFeedback)
                .createQueryBuilder()
                .delete()
                .where(
                    'message_id IN (SELECT id FROM seller_copilot_messages WHERE conversation_id = :conversationId)',
                    { conversationId },
                )
                .execute();

            const result = await conversationRepository.delete({
                ...scope,
                id: conversationId,
            });
            return (result.affected ?? 0) > 0;
        });
    }

    // Chỉ lấy cửa sổ message mới nhất thay vì nạp cả conversation; trả ASC để planner đọc đúng trình tự hội thoại.
    async findMessagesByConversation(
        conversationId: string,
        limit: number,
    ): Promise<SellerCopilotMessageRecord[]> {
        // Giới hạn âm hoặc 0 trả về mảng rỗng, không query database; tránh nạp cả conversation quá lớn.
        const safeLimit = Math.max(0, Math.floor(limit));
        if (!safeLimit) return [];

        // Lấy N message gần nhất theo createdAt DESC, id DESC để tối ưu index; sau đó đảo lại ASC để trả về đúng thứ tự hội thoại.
        const latestMessages = await this.messageRepository.find({
            where: { conversationId },
            order: { createdAt: 'DESC', id: 'DESC' },
            take: safeLimit,
        });

        // Đảo lại ASC để trả về đúng thứ tự hội thoại; UI có thể hiển thị trực tiếp mà không cần sort lại.
        return latestMessages.reverse();
    }

    // Đọc ngược một trang message bằng cursor thời gian; query lấy DESC để tối ưu index rồi đảo lại ASC
    // trước khi trả về, nhờ đó UI có thể chèn trang cũ lên đầu mà thứ tự hội thoại vẫn đúng.
    async findMessagePageByConversation(
        conversationId: string,
        before: Date | undefined,
        beforeId: string | undefined,
        limit: number,
    ): Promise<{
        items: SellerCopilotMessageRecord[];
        hasMore: boolean;
    }> {
        const query = this.messageRepository
            .createQueryBuilder('message')
            .where('message.conversationId = :conversationId', {
                conversationId,
            })
            .orderBy('message.createdAt', 'DESC')
            .addOrderBy('message.id', 'DESC')
            .take(limit + 1);

        if (before) {
            query.andWhere(
                new Brackets((builder) => {
                    builder
                        .where('message.createdAt < :before', { before })
                        .orWhere(
                            'message.createdAt = :before AND message.id < :beforeId',
                            { before, beforeId },
                        );
                }),
            );
        }

        const rows = await query.getMany();

        const hasMore = rows.length > limit;
        return {
            items: rows.slice(0, limit).reverse(),
            hasMore,
        };
    }

    async findMessageInScope(
        scope: SellerCopilotScope,
        messageId: string,
    ): Promise<SellerCopilotMessageRecord | null> {
        return this.messageRepository
            .createQueryBuilder('message')
            .innerJoin(
                SellerCopilotConversation,
                'conversation',
                'conversation.id = message.conversation_id',
            )
            .where('message.id = :messageId', { messageId })
            .andWhere('conversation.ownerUserId = :ownerUserId', {
                ownerUserId: scope.ownerUserId,
            })
            .andWhere('conversation.shopId = :shopId', {
                shopId: scope.shopId,
            })
            .getOne();
    }

    async saveFeedback(input: {
        messageId: string;
        ownerUserId: string;
        shopId: string;
        rating: 'up' | 'down';
        reason: string | null;
    }): Promise<SellerCopilotFeedbackRecord> {
        return this.feedbackRepository.save(
            this.feedbackRepository.create(input),
        );
    }
}
