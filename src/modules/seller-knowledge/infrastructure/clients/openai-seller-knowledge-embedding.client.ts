// Adapter chuyển văn bản knowledge thành vector; không sở hữu nội dung tài liệu hay quyết định phiên bản nào được kích hoạt.
// Khóa/model chỉ lấy từ cấu hình backend và vector trả về phải giữ đúng thứ tự đầu vào để ghép chính xác với từng chunk.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerKnowledgeEmbeddingPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import { fetchSellerKnowledgeWithRetry } from '@/modules/seller-knowledge/infrastructure/clients/seller-knowledge-fetch.util';

// Thực thi hợp đồng tạo embedding bằng OpenAI; lỗi cấu hình, HTTP hoặc output đều được chuyển thành lỗi dịch vụ có thể hiểu được.
@Injectable()
export class OpenAiSellerKnowledgeEmbeddingClient implements SellerKnowledgeEmbeddingPort {
    // Cấu hình server giữ API key và model khỏi payload do quản trị viên gửi từ trình duyệt.
    constructor(private readonly config: ConfigService) {}

    // Nhận từng đoạn văn bản và trả về một vector tương ứng theo đúng thứ tự; caller dùng vị trí này để gắn vector lại với chunk.
    // Chỉ gọi dịch vụ embedding, không sinh câu trả lời hay tự lưu dữ liệu vào PostgreSQL/Qdrant.
    // Nếu thiếu khóa, provider lỗi, quá thời gian hoặc trả vector thiếu/rỗng thì dừng publish để không tạo index một phần.
    async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
        // Đọc khóa ở server để credential không xuất hiện trong payload FE hoặc log request quản trị.
        const key = this.config.get<string>('OPENAI_API_KEY', '');
        // Từ chối sớm trước khi gọi mạng vì request không xác thực sẽ luôn thất bại và không thể tạo vector.
        if (!key)
            throw new ServiceUnavailableException(
                'Embedding provider chưa được cấu hình.',
            );

        // Chặn cấu hình dimension lỗi trước network call để không tạo vector sai schema cho collection Qdrant.
        const dimensions = Number(
            this.config.get<string>(
                'SELLER_KNOWLEDGE_EMBEDDING_DIMENSIONS',
                '3072',
            ),
        );
        if (!Number.isInteger(dimensions) || dimensions < 1)
            throw new ServiceUnavailableException(
                'Kích thước embedding chưa được cấu hình hợp lệ.',
            );

        // Gửi batch trong một request; model biến mỗi input thành vector số theo đúng thứ tự index provider trả về.
        // Timeout giới hạn thời gian chờ để tác vụ publish không treo vô hạn khi provider không phản hồi.
        const body = JSON.stringify({
            model: this.config.get<string>(
                'SELLER_KNOWLEDGE_EMBEDDING_MODEL',
                'text-embedding-3-large',
            ),
            dimensions,
            input: inputs,
        });
        const response = await fetchSellerKnowledgeWithRetry(
            'OpenAI',
            'embedding creation',
            () =>
                fetch('https://api.openai.com/v1/embeddings', {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${key}`,
                        'content-type': 'application/json',
                    },
                    // Tạo timeout mới cho mỗi lần thử; tín hiệu hủy từ caller vẫn dừng ngay, không bị retry.
                    signal: signal
                        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
                        : AbortSignal.timeout(30_000),
                    body,
                }),
        );
        // Không tiếp tục với body lỗi của provider vì dữ liệu đó không phải tập vector hợp lệ để ghi vào Qdrant.
        if (!response.ok)
            throw new ServiceUnavailableException(
                'Embedding provider không xử lý được tài liệu.',
            );

        // Provider trả mỗi vector kèm index đầu vào; kiểu cục bộ mô tả đúng phần response mà adapter cần dùng.
        const result = (await response.json()) as {
            data?: { index: number; embedding: number[] }[];
        };
        // Lưu theo đúng slot input thay vì chỉ sort: response thiếu/lặp index có thể vẫn đủ số dòng nhưng ghép sai chunk.
        const vectorsByIndex: (number[] | undefined)[] = Array(
            inputs.length,
        ).fill(undefined);
        const seenIndexes = new Set<number>();
        for (const item of result.data ?? []) {
            if (
                !Number.isInteger(item.index) ||
                item.index < 0 ||
                item.index >= inputs.length ||
                seenIndexes.has(item.index)
            ) {
                throw new ServiceUnavailableException(
                    'Embedding provider trả về thứ tự dữ liệu không hợp lệ.',
                );
            }
            seenIndexes.add(item.index);
            vectorsByIndex[item.index] = item.embedding;
        }

        // Từ chối thiếu vector, sai dimension hoặc giá trị không hữu hạn để tránh ghi point không thể truy vấn.
        if (
            vectorsByIndex.some(
                (vector) =>
                    !Array.isArray(vector) ||
                    vector.length !== dimensions ||
                    vector.some((value) => !Number.isFinite(value)),
            )
        ) {
            throw new ServiceUnavailableException(
                'Embedding provider trả về dữ liệu không hợp lệ.',
            );
        }
        // Sau validation, mọi slot được kiểm tra là vector đủ dimension; ép kiểu chỉ phản ánh invariant vừa xác lập.
        return vectorsByIndex as number[][];
    }
}
