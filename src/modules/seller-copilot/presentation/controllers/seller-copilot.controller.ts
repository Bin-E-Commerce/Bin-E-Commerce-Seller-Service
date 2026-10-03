// Controller này giữ ranh giới HTTP/SSE: xác thực request rồi chuyển event use case thành SSE.
// Không tự phân loại câu hỏi, truy vấn dữ liệu hoặc quyết định nội dung nghiệp vụ.
import {
    Controller,
    DefaultValuePipe,
    Delete,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Logger,
    Patch,
    Param,
    ParseIntPipe,
    Post,
    Body,
    Query,
    Req,
    Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import { ConversationHistoryService } from '@/modules/seller-copilot/application/conversation/history/conversation-history.service';
import { ConversationPersistenceService } from '@/modules/seller-copilot/application/conversation/persistence/conversation-persistence.service';
import {
    SellerCopilotChatDto,
    SellerCopilotFeedbackDto,
    SellerCopilotPinConversationDto,
    SellerCopilotRenameConversationDto,
} from '@/modules/seller-copilot/presentation/dto/seller-copilot.dto';

@Controller('seller/ai/copilot')
export class SellerCopilotController {
    private readonly logger = new Logger(SellerCopilotController.name);

    // NestJS inject bộ đọc lịch sử, bộ ghi thay đổi hội thoại và use case stream câu trả lời.
    constructor(
        private readonly history: ConversationHistoryService,
        private readonly persistence: ConversationPersistenceService,
        private readonly streamCopilot: StreamSellerCopilotUseCase,
    ) {}

    // Xác minh tenant và conversation trước khi mở SSE để lỗi quyền/ID sai vẫn giữ HTTP status chuẩn.
    // Theo dõi disconnect ngay từ preflight; hủy planner khi client rời đi thay vì tiếp tục tiêu thụ generator.
    // Stream tôn trọng backpressure, phát event error sau khi headers đã gửi và luôn dọn listener ở finally.
    @Post('chat/stream')
    async streamChat(
        @Headers('x-user-id') ownerUserId: string,
        @Body() body: SellerCopilotChatDto,
        @Req() request: Request,
        @Res() response: Response,
    ): Promise<void> {
        const requestId = String(
            request.headers['x-request-id'] ?? randomUUID(),
        );
        const abortController = new AbortController();
        let clientClosed = false;

        // Lắng nghe response từ đầu vì Gateway có thể hủy request khi DB còn đang chuẩn bị conversation.
        const handleResponseClose = () => {
            if (!response.writableEnded) {
                clientClosed = true;
                abortController.abort();
            }
        };
        response.once('close', handleResponseClose);

        // Chuẩn bị một lần để xác thực owner, lấy/tạo conversation và giữ scope đã kiểm tra; không nhận shopId từ body.
        let preparedChat: Awaited<
            ReturnType<StreamSellerCopilotUseCase['prepare']>
        >;
        try {
            preparedChat = await this.streamCopilot.prepare(ownerUserId, body);
        } catch (error) {
            response.off('close', handleResponseClose);
            throw error;
        }

        // Nếu client rời đi trong preflight thì không mở SSE và không gọi planner sau khi DB trả kết quả.
        if (clientClosed) {
            response.off('close', handleResponseClose);
            return;
        }

        // SSE cần kết nối mở lâu hơn HTTP thông thường; các header này yêu cầu proxy không cache hoặc gom chunk.
        // X-Accel-Buffering là header riêng của Nginx để tắt buffer; các proxy khác có thể cần header tương tự.
        // Content-Type là text/event-stream để client hiểu đây là SSE; charset=utf-8 để tránh lỗi decode ký tự.\
        // Cache-Control: no-cache để client không cache; no-transform để proxy không thay đổi nội dung.
        // Connection: keep-alive để giữ kết nối mở lâu; SSE cần kết nối liên tục.
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();

        try {
            // Chuyển cùng snapshot đã xác minh và AbortSignal xuống use case để request dừng tới tận provider AI.
            for await (const event of this.streamCopilot.execute(
                preparedChat,
                body,
                requestId,
                abortController.signal,
            )) {
                // break gọi return() trên async generator, không âm thầm chạy nốt các bước có thể tốn chi phí.
                if (clientClosed) break;

                // Ghi event theo định dạng SSE: event: <type>\ndata: <json>\n\n; JSON.stringify để gửi object.
                // Mục đích là gửi event theo chuẩn SSE, client sẽ nhận và xử lý từng event theo type.
                const canContinue = response.write(
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );

                // Dùng để đảm bảo event được gửi ngay lập tức, tránh bị buffer ở proxy hoặc adapter.
                // Một số adapter/proxy cần flush tường minh; gọi tùy chọn sau mỗi event để nội dung không bị giữ tới cuối.
                const flushableResponse = response as Response & {
                    flush?: () => void;
                };

                // Nếu adapter hỗ trợ flush thì gọi flush để gửi ngay event; nếu không có flush thì bỏ qua.
                flushableResponse.flush?.();

                // Khi socket đầy buffer, chờ drain; nếu socket đóng/error thì dừng producer để không tăng RAM.
                if (
                    !canContinue &&
                    !(await this.waitForResponseDrain(response))
                ) {
                    clientClosed = true;
                    abortController.abort();
                    break;
                }
            }
        } catch (error) {
            // Headers đã flush nên không thể đổi status; chỉ trả lỗi công khai đã chuẩn hóa, không lộ exception nội bộ.
            if (!clientClosed) {
                this.logger.error(
                    JSON.stringify({
                        event: 'seller_copilot_stream_failed',
                        requestId,
                        errorType:
                            error instanceof Error
                                ? error.name
                                : 'unknown_error',
                    }),
                );
                if (!response.destroyed && !response.writableEnded) {
                    response.write(
                        `event: error\ndata: ${JSON.stringify({
                            type: 'error',
                            code: 'COPILOT_REQUEST_FAILED',
                            retryable: true,
                            message: 'Không thể hoàn tất câu trả lời lúc này.',
                        })}\n\n`,
                    );
                }
            }
        } finally {
            // Gỡ listener luôn; không gọi end lần nữa với response đã kết thúc hoặc socket đã ngắt sớm.
            response.off('close', handleResponseClose);
            if (!clientClosed && !response.writableEnded) {
                response.end();
            }
        }
    }

    // Chờ buffer socket thoát backpressure; close/error giải phóng promise để request không mắc kẹt.
    private waitForResponseDrain(response: Response): Promise<boolean> {
        return new Promise((resolve) => {
            const cleanup = () => {
                response.off('drain', handleDrain);
                response.off('close', handleClose);
                response.off('error', handleClose);
            };
            const handleDrain = () => {
                cleanup();
                resolve(true);
            };
            const handleClose = () => {
                cleanup();
                resolve(false);
            };

            response.once('drain', handleDrain);
            response.once('close', handleClose);
            response.once('error', handleClose);
        });
    }

    // Liệt kê hội thoại của user hiện tại; offset/limit mặc định lần lượt là 0/20 và được ParseIntPipe ép thành số.
    // Ownership và giới hạn truy vấn thực tế do history service kiểm tra, controller không nhận owner/shop từ query.
    @Get('conversations')
    listConversations(
        @Headers('x-user-id') ownerUserId: string,
        @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    ) {
        return this.history.listConversations(ownerUserId, offset, limit);
    }

    // Tìm hội thoại theo từ khóa q trong phạm vi user hiện tại; chuẩn hóa q thiếu thành chuỗi rỗng trước khi chuyển tiếp.
    // Service chịu trách nhiệm kiểm tra quyền và thực hiện tìm kiếm, controller không tự truy vấn kho dữ liệu.
    @Get('conversations/search')
    searchConversations(
        @Headers('x-user-id') ownerUserId: string,
        @Query('q') query: string,
    ) {
        return this.history.searchConversations(ownerUserId, query ?? '');
    }

    // Lấy thông tin một hội thoại cùng một trang message, có thể phân trang lùi bằng before và giới hạn bằng limit.
    // conversationId/before được chuyển nguyên trạng; history service xác minh ownership trước khi trả dữ liệu.
    @Get('conversations/:conversationId')
    getConversation(
        @Headers('x-user-id') ownerUserId: string,
        @Param('conversationId') conversationId: string,
        @Query('before') before?: string,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    ) {
        return this.history.getConversation(
            ownerUserId,
            conversationId,
            before,
            limit,
        );
    }

    // Đặt trạng thái pin theo giá trị isPinned thay vì tạo thao tác toggle; gửi lại cùng request không đảo trạng thái lần nữa.
    // Persistence service kiểm tra conversation thuộc user hiện tại và chịu trách nhiệm lưu thay đổi.
    @Patch('conversations/:conversationId/pin')
    setConversationPinned(
        @Headers('x-user-id') ownerUserId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: SellerCopilotPinConversationDto,
    ) {
        return this.persistence.setConversationPinned(
            ownerUserId,
            conversationId,
            body.isPinned,
        );
    }

    // Đổi tiêu đề hội thoại bằng title đã qua DTO validation; persistence service kiểm tra quyền sở hữu rồi mới lưu.
    // Controller chỉ chuyển owner, conversationId và title, không tự sửa hoặc ghi dữ liệu.
    @Patch('conversations/:conversationId/title')
    renameConversation(
        @Headers('x-user-id') ownerUserId: string,
        @Param('conversationId') conversationId: string,
        @Body() body: SellerCopilotRenameConversationDto,
    ) {
        return this.persistence.renameConversation(
            ownerUserId,
            conversationId,
            body.title,
        );
    }

    // Yêu cầu xóa hội thoại; persistence service xác minh quyền sở hữu trước khi xóa dữ liệu liên quan.
    // Trả 204 No Content khi thành công để client hiểu thao tác hoàn tất nhưng không có body response.
    @Delete('conversations/:conversationId')
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteConversation(
        @Headers('x-user-id') ownerUserId: string,
        @Param('conversationId') conversationId: string,
    ): Promise<void> {
        return this.persistence.deleteConversation(ownerUserId, conversationId);
    }

    // Ghi nhận đánh giá up/down và lý do tùy chọn cho một message; đây là dữ liệu phản hồi, không phải lệnh nghiệp vụ seller.
    // DTO giới hạn messageId/rating/reason, còn persistence service xử lý việc xác minh và lưu feedback.
    @Post('feedback')
    addFeedback(
        @Headers('x-user-id') ownerUserId: string,
        @Body() body: SellerCopilotFeedbackDto,
    ) {
        return this.persistence.addFeedback(ownerUserId, body);
    }
}
