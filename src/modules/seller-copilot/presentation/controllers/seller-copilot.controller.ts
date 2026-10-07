// Controller này giữ ranh giới HTTP/SSE: xác thực request rồi chuyển event use case thành SSE.
// Không tự phân loại câu hỏi, truy vấn dữ liệu hoặc quyết định nội dung nghiệp vụ.
import {
    Controller,
    DefaultValuePipe,
    Delete,
    Get,
    Headers,
    HttpException,
    HttpCode,
    HttpStatus,
    Logger,
    Patch,
    Param,
    ParseIntPipe,
    Post,
    ParseUUIDPipe,
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
import { ConfirmSellerInventoryActionUseCase } from '@/modules/seller-copilot/application/modes/agent/actions/confirm-seller-inventory-action.use-case';
import { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import {
    SellerCopilotChatDto,
    SellerCopilotFeedbackDto,
    SellerCopilotPinConversationDto,
    SellerCopilotRenameConversationDto,
    SellerCopilotModeSessionDto,
} from '@/modules/seller-copilot/presentation/dto/seller-copilot.dto';

@Controller('seller/ai/copilot')
// HTTP adapter chỉ lo ownership preflight, vòng đời kết nối SSE và map transport; nghiệp vụ chat nằm ở application services.
export class SellerCopilotController {
    private readonly logger = new Logger(SellerCopilotController.name);

    // NestJS inject bộ đọc lịch sử, bộ ghi thay đổi hội thoại và use case stream câu trả lời.
    constructor(
        private readonly history: ConversationHistoryService,
        private readonly persistence: ConversationPersistenceService,
        private readonly streamCopilot: StreamSellerCopilotUseCase,
        private readonly confirmInventoryAction: ConfirmSellerInventoryActionUseCase,
        private readonly modeSessions: ConversationModeSessionService,
    ) {}

    // Tạo phiên mode mới trong conversation hiện tại; tenant được resolve từ identity Gateway, không từ payload.
    // Service trả cùng session nếu request lặp cho mode đang hoạt động, tránh tạo divider trùng khi client retry.
    @Post('conversations/:conversationId/mode-sessions')
    async startModeSession(
        @Headers('x-user-id') ownerUserId: string,
        @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
        @Body() body: SellerCopilotModeSessionDto,
    ) {
        return this.modeSessions.startModeSession(
            ownerUserId,
            conversationId,
            body.interactionMode,
        );
    }

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
            preparedChat = await this.streamCopilot.prepare(ownerUserId, body, {
                email: this.getHeader(request, 'x-user-email'),
                permissions: this.getHeader(request, 'x-user-permissions')
                    .split(',')
                    .map((permission) => permission.trim())
                    .filter(Boolean),
            });
        } catch (error) {
            response.off('close', handleResponseClose);
            throw error;
        }

        // Nếu client rời đi trong preflight thì không mở SSE và không gọi planner sau khi DB trả kết quả.
        if (clientClosed) {
            response.off('close', handleResponseClose);
            return;
        }

        // Flush header trước planner để browser nhận được kết nối và trạng thái sớm, không phải chờ cả câu trả lời.
        // no-transform/no-buffering hạn chế proxy gộp delta; nếu proxy khác Nginx còn buffer thì cần cấu hình tại proxy đó.
        // Sau lần flush này không thể đổi HTTP status, nên lỗi trong stream phải được gửi bằng event SSE `error`.
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

                // Mỗi event là một frame SSE độc lập; JSON giữ payload có cấu trúc và không làm mất metadata/citation.
                const canContinue = response.write(
                    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
                );

                // Một số middleware/adapter hỗ trợ flush tường minh; gọi có điều kiện để giảm độ trễ của delta.
                const flushableResponse = response as Response & {
                    flush?: () => void;
                };

                // Flush không thay thế xử lý backpressure; socket đầy vẫn phải chờ drain ở khối dưới.
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

    // Mở SSE trước external call để giao diện thấy ngay trạng thái xác nhận; response đã flush nên mọi lỗi được trả bằng action_result.
    // Chỉ chuyển identity do Gateway xác thực và proposalId opaque; use case kiểm tra owner/shop, còn Product Service kiểm tra quyền + tồn mới nhất.
    // Lỗi nghiệp vụ 4xx được giải thích an toàn; lỗi downstream không lộ nội bộ và không được báo thành công khi chưa có kết quả ghi.
    @Post('actions/:proposalId/confirm')
    async confirmInventory(
        @Headers('x-user-id') ownerUserId: string,
        @Param('proposalId', new ParseUUIDPipe()) proposalId: string,
        @Req() request: Request,
        @Res() response: Response,
    ): Promise<void> {
        response.status(200);
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders();

        // Trả trạng thái trước khi gọi Product Service để seller thấy thao tác đang được xác minh/ghi nhận.
        response.write(
            'event: status\ndata: {"type":"status","phase":"action_confirm","message":"Đang kiểm tra quyền và cập nhật tồn kho…"}\n\n',
        );
        try {
            const result = await this.confirmInventoryAction.confirm({
                ownerUserId,
                proposalId,
                email: this.getHeader(request, 'x-user-email'),
                permissions: this.getHeader(request, 'x-user-permissions')
                    .split(',')
                    .map((permission) => permission.trim())
                    .filter(Boolean),
            });
            response.write(
                `event: action_result\ndata: ${JSON.stringify({ type: 'action_result', ...result })}\n\n`,
            );
        } catch (error) {
            // Chỉ trả thông điệp nghiệp vụ 4xx; lỗi nội bộ không được lộ stack hoặc chi tiết downstream qua SSE.
            const message =
                error instanceof HttpException && error.getStatus() < 500
                    ? extractHttpExceptionMessage(error)
                    : 'Không thể xác nhận cập nhật tồn kho lúc này. Bạn hãy tạo đề xuất mới hoặc thử lại sau.';
            response.write(
                `event: action_result\ndata: ${JSON.stringify({ type: 'action_result', proposalId, status: 'failed', message })}\n\n`,
            );
        } finally {
            response.write(
                `event: done\ndata: ${JSON.stringify({ type: 'done', dataAsOf: new Date().toISOString(), citations: [], latencyMs: 0 })}\n\n`,
            );
            response.end();
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

    // Đọc header đơn hoặc header lặp để chỉ chuyển identity do Gateway gắn vào request nội bộ.
    private getHeader(request: Request, name: string): string {
        const value = request.headers[name];
        if (Array.isArray(value)) return value[0] ?? '';
        return value ?? '';
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

// Trích message từ exception HTTP theo dạng string hoặc Nest response object, fallback về mô tả an toàn.
function extractHttpExceptionMessage(error: HttpException): string {
    const payload = error.getResponse();
    if (typeof payload === 'string') return payload;
    if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload
    ) {
        const message = payload.message;
        if (typeof message === 'string') return message;
        if (
            Array.isArray(message) &&
            message.every((item) => typeof item === 'string')
        ) {
            return message.join(' ');
        }
    }
    return 'Không thể xác nhận cập nhật tồn kho.';
}
