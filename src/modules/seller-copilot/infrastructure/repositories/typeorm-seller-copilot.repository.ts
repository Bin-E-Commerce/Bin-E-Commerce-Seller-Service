// Adapter TypeORM của Seller Copilot; toàn bộ query, join, pagination và mapping persistence nằm ở đây.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { SellerCopilotConversation } from '@/database/seller-copilot/entities/seller-copilot-conversation.entity';
import { SellerCopilotFeedback } from '@/database/seller-copilot/entities/seller-copilot-feedback.entity';
import { SellerCopilotMessage } from '@/database/seller-copilot/entities/seller-copilot-message.entity';
import { SellerCopilotActionProposal } from '@/database/seller-copilot/entities/seller-copilot-action-proposal.entity';
import type {
    SellerCopilotConversationRecord,
    SellerCopilotFeedbackRecord,
    SellerCopilotMessageRecord,
    SellerCopilotRepositoryPort,
    SellerCopilotScope,
    SellerCopilotSearchResult,
} from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotActionProposalRecord } from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';

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

    // Lưu nội dung và metadata citation cùng message để SSE và lịch sử sau reload tham chiếu cùng một tập nguồn.
    // Metadata null vẫn giữ backward compatibility cho user message và các phản hồi không grounded.
    async saveMessage(input: {
        conversationId: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        metadata?: SellerCopilotMessage['metadata'];
    }): Promise<void> {
        await this.messageRepository.save(input);
    }

    // Phân trang theo tenant đã resolve; pin được ưu tiên trước các conversation mới cập nhật gần đây.
    // Repository nhận offset/limit đã qua service validation, chỉ trả metadata list và không nạp message body.
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

    // Tìm trong title/message thuộc đúng owner và shop; query builder giữ scope trong SQL thay vì lọc sau khi tải dữ liệu.
    // Kết quả thô được gom theo conversation, giới hạn scan 100 dòng rồi trả tối đa 20 phiên để chi phí tìm kiếm có trần.
    async searchConversations(
        scope: SellerCopilotScope,
        query: string,
    ): Promise<SellerCopilotSearchResult[]> {
        // Wildcard được đưa qua parameter binding, không nối trực tiếp vào SQL; scope owner/shop luôn gắn ở query trước khi giới hạn.
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
        // Rows đã sắp mới nhất trước; bỏ trùng giữ snippet mới nhất cho mỗi conversation và dừng ở 20 kết quả UI hỗ trợ.
        for (const row of rows) {
            // Một conversation có thể khớp title và nhiều message; chỉ dùng hit đầu tiên đã được xếp hạng gần nhất.
            if (uniqueResults.has(row.conversationId)) continue;
            uniqueResults.set(row.conversationId, row);
            if (uniqueResults.size === 20) break;
        }

        return Array.from(uniqueResults.values());
    }

    // Tra conversation theo cả owner/shop và ID để ID đoán được của tenant khác luôn trả null.
    async findConversation(
        scope: SellerCopilotScope,
        conversationId: string,
    ): Promise<SellerCopilotConversationRecord | null> {
        // Chỉ tìm conversation trong scope đã xác định; không reveal thông tin conversation cho tenant khác.
        return this.conversationRepository.findOne({
            where: { ...scope, id: conversationId },
        });
    }

    // Tạo conversation trong scope caller đã xác thực; save thực hiện insert và trả cả ID/timestamps do DB sinh.
    async createConversation(input: {
        ownerUserId: string;
        shopId: string;
        title: string;
    }): Promise<SellerCopilotConversationRecord> {
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
        // Null đồng thời bao phủ ID không có và ID ngoài tenant; không thực hiện save khi scope không khớp.
        if (!conversation) return null;

        // pinnedAt là mốc pin, không phải updatedAt của chat; unpin xóa mốc để UI sắp xếp lại nhóm ghim.
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
        // Không tạo mới hoặc upsert ID lạ; null cho caller biết conversation không thuộc scope hiện tại.
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
            // Tạo repository từ cùng EntityManager để mọi thao tác dọn và xóa cùng commit/rollback.
            const conversationRepository = manager.getRepository(
                SellerCopilotConversation,
            );
            const conversation = await conversationRepository.findOne({
                where: { ...scope, id: conversationId },
                select: { id: true },
            });
            // Scope được kiểm tra trước khi dọn feedback; ID tenant khác không làm phát sinh side effect.
            if (!conversation) return false;

            // Feedback tham chiếu message nhưng không cascade; xóa feedback trước, còn message tự cascade theo FK conversation.
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
            // affected=0 có thể xảy ra nếu bản ghi thay đổi đồng thời; phản ánh thất bại thay vì báo xóa thành công giả.
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

        // Lấy dư một row để tính hasMore mà không COUNT toàn bộ; row sentinel bị bỏ trước khi trả trang cho UI.
        const hasMore = rows.length > limit;
        return {
            items: rows.slice(0, limit).reverse(),
            hasMore,
        };
    }

    // Lưu snapshot hành động chờ xác nhận để request xác nhận sau có thể tái kiểm tra đúng tenant.
    async createActionProposal(input: {
        conversationId: string;
        ownerUserId: string;
        shopId: string;
        payload: SellerCopilotActionProposalRecord['payload'];
        expiresAt: Date;
    }): Promise<SellerCopilotActionProposalRecord> {
        const repository = this.dataSource.getRepository(
            SellerCopilotActionProposal,
        );
        const proposal = await repository.save(
            repository.create({
                ...input,
                status: 'pending',
                result: null,
                completedAt: null,
            }),
        );
        return this.toActionProposalRecord(proposal);
    }

    // Khóa row trong transaction để hai xác nhận đồng thời không thể cùng tiêu thụ một proposal.
    // Chỉ proposal pending, chưa hết hạn và đúng owner/shop mới chuyển sang processing; mọi trường hợp khác trả null.
    // Trạng thái processing được commit trước external call để không giữ lock DB trong lúc chờ Product Service.
    async consumeActionProposal(
        scope: SellerCopilotScope,
        proposalId: string,
    ): Promise<SellerCopilotActionProposalRecord | null> {
        return this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(
                SellerCopilotActionProposal,
            );
            const proposal = await repository.findOne({
                where: { ...scope, id: proposalId },
                lock: { mode: 'pessimistic_write' },
            });
            // Tenant được áp ngay trong WHERE và row lock giữ trạng thái tới lúc chuyển pending→processing.
            if (
                !proposal ||
                proposal.status !== 'pending' ||
                proposal.expiresAt.getTime() <= Date.now()
            ) {
                return null;
            }

            proposal.status = 'processing';
            return this.toActionProposalRecord(await repository.save(proposal));
        });
    }

    // Hoàn tất proposal trong transaction, chỉ chấp nhận trạng thái processing để không ghi đè kết quả terminal.
    // Đồng thời cập nhật metadata message assistant để reload lịch sử hiển thị cùng trạng thái với proposal.
    // Nếu proposal không còn processing, transaction thoát mà không sửa message để request lặp không đảo kết quả.
    async completeActionProposal(
        scope: SellerCopilotScope,
        proposalId: string,
        status: 'completed' | 'failed',
        result: Record<string, unknown>,
    ): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(
                SellerCopilotActionProposal,
            );
            const proposal = await repository.findOne({
                where: { ...scope, id: proposalId, status: 'processing' },
                lock: { mode: 'pessimistic_write' },
            });
            if (!proposal) return;
            // Chỉ processing được kết thúc; proposal terminal hoặc ngoài scope không thể bị request lặp ghi đè.
            proposal.status = status;
            proposal.result = result;
            proposal.completedAt = new Date();
            await repository.save(proposal);

            // Cập nhật metadata của assistant message cùng transaction để lịch sử hiển thị đúng trạng thái sau khi tải lại.
            const messageRepository =
                manager.getRepository(SellerCopilotMessage);
            const actionMessage = await messageRepository
                .createQueryBuilder('message')
                .innerJoin(
                    SellerCopilotConversation,
                    'conversation',
                    'conversation.id = message.conversation_id',
                )
                .where('message.role = :role', { role: 'assistant' })
                .andWhere('conversation.id = :conversationId', {
                    conversationId: proposal.conversationId,
                })
                .andWhere(
                    "message.metadata -> 'actionProposal' ->> 'proposalId' = :proposalId",
                    { proposalId },
                )
                .setLock('pessimistic_write')
                .getOne();
            if (actionMessage?.metadata?.actionProposal) {
                // Nếu message đã bị xóa/metadata cũ thì vẫn giữ proposal result; không tạo message mới ngoài luồng chat.
                actionMessage.metadata.actionProposal.status = status;
                actionMessage.metadata.actionProposal.result = result;
                await messageRepository.save(actionMessage);
            }
        });
    }

    // Bỏ metadata TypeORM khỏi contract application để code nghiệp vụ không phụ thuộc entity/database.
    private toActionProposalRecord(
        proposal: SellerCopilotActionProposal,
    ): SellerCopilotActionProposalRecord {
        return {
            id: proposal.id,
            conversationId: proposal.conversationId,
            ownerUserId: proposal.ownerUserId,
            shopId: proposal.shopId,
            status: proposal.status,
            payload: proposal.payload,
            expiresAt: proposal.expiresAt,
        };
    }

    // Xác minh message tồn tại trong conversation thuộc đúng owner/shop trước khi cho phép ghi feedback.
    // Join scope trong cùng SQL query để không tạo khoảng hở giữa bước check quyền và lấy message.
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

    // Lưu feedback sau khi application đã xác minh message thuộc owner/shop; adapter không tự quyết định quyền truy cập.
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
