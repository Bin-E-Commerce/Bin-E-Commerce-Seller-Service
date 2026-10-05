import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Adapter gọi Media Service nội bộ để source Markdown được lưu trong object storage do Media quản lý.
// Seller Service chỉ giữ object key trong metadata; client này không ghi nội dung source trực tiếp vào PostgreSQL hoặc Qdrant.
@Injectable()
export class SellerKnowledgeStorageClient {
    private readonly baseUrl: string;
    private readonly token: string;

    // Chuẩn hóa base URL một lần và giữ shared token chỉ trong backend cho mọi request nội bộ.
    constructor(config: ConfigService) {
        this.baseUrl = config
            .get<string>('MEDIA_SERVICE_URL', 'http://media-service:3004')
            .replace(/\/$/u, '');
        this.token = config.get<string>('INTERNAL_SERVICE_TOKEN', '');
    }

    // Upload Markdown theo revision UUID để ID dùng nhất quán ở API Media và bản ghi PostgreSQL.
    // Timeout/lỗi HTTP/response thiếu objectKey đều dừng luồng trước khi caller ghi metadata không thể khôi phục source.
    async store(revisionId: string, markdown: string): Promise<string> {
        // Gửi nội dung đầy đủ tới endpoint nội bộ đã được bảo vệ bằng shared token; object key do Media sinh/trả về.
        const response = await fetch(
            `${this.baseUrl}/api/v1/media/assets/internal/knowledge/revisions/${revisionId}`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-internal-service-token': this.token,
                },
                signal: AbortSignal.timeout(30_000),
                body: JSON.stringify({ markdown }),
            },
        );
        // Không tiếp tục parse body lỗi vì response không đảm bảo theo contract lưu object.
        if (!response.ok)
            throw new ServiceUnavailableException(
                'Không thể lưu bản Markdown vào kho tài liệu.',
            );
        // Caller chỉ cần objectKey làm tham chiếu DB; nội dung Markdown không được trả về như metadata.
        const body = (await response.json()) as { objectKey?: string };
        if (!body.objectKey)
            throw new ServiceUnavailableException(
                'Kho tài liệu trả về vị trí lưu không hợp lệ.',
            );
        return body.objectKey;
    }

    // Đọc source chỉ bằng revisionId do service đã tra DB, không nhận objectKey từ request để tránh truy cập object tùy ý.
    async read(revisionId: string): Promise<string> {
        const response = await fetch(
            `${this.baseUrl}/api/v1/media/assets/internal/knowledge/revisions/${revisionId}`,
            {
                headers: { 'x-internal-service-token': this.token },
                signal: AbortSignal.timeout(30_000),
            },
        );
        // Báo lỗi nếu Media không tìm được source để preview/publish không xử lý nội dung rỗng giả.
        if (!response.ok)
            throw new ServiceUnavailableException(
                'Không thể đọc bản Markdown từ kho tài liệu.',
            );
        return response.text();
    }

    // Xóa đúng object của revision trong bước bù trừ sau khi PostgreSQL xác nhận insert revision thất bại.
    // Không gọi xóa trong luồng archive vì archive giữ lịch sử và source để phục hồi/rollback.
    async delete(revisionId: string): Promise<void> {
        const response = await fetch(
            `${this.baseUrl}/api/v1/media/assets/internal/knowledge/revisions/${revisionId}`,
            {
                method: 'DELETE',
                headers: { 'x-internal-service-token': this.token },
                signal: AbortSignal.timeout(30_000),
            },
        );
        // Nếu cleanup thất bại, ném lỗi để service log cảnh báo; service vẫn giữ nguyên lỗi persistence gốc.
        if (!response.ok)
            throw new ServiceUnavailableException(
                'Không thể dọn bản Markdown không có metadata.',
            );
    }
}
