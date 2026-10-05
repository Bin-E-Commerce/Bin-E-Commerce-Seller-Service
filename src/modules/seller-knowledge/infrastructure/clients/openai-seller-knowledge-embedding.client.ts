// Adapter chuyển văn bản knowledge thành vector; không sở hữu nội dung tài liệu hay quyết định phiên bản nào được kích hoạt.
// Khóa/model chỉ lấy từ cấu hình backend và vector trả về phải giữ đúng thứ tự đầu vào để ghép chính xác với từng chunk.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SellerKnowledgeEmbeddingPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';

// Thực thi hợp đồng tạo embedding bằng OpenAI; lỗi cấu hình, HTTP hoặc output đều được chuyển thành lỗi dịch vụ có thể hiểu được.
@Injectable()
export class OpenAiSellerKnowledgeEmbeddingClient implements SellerKnowledgeEmbeddingPort {
    // Inject cấu hình backend để bí mật và lựa chọn model không cần truyền qua request của quản trị viên.
    constructor(private readonly config: ConfigService) {}

    // Nhận từng đoạn văn bản và trả về một vector tương ứng theo đúng thứ tự; caller dùng vị trí này để gắn vector lại với chunk.
    // Chỉ gọi dịch vụ embedding, không sinh câu trả lời hay tự lưu dữ liệu vào PostgreSQL/Qdrant.
    // Nếu thiếu khóa, provider lỗi, quá thời gian hoặc trả vector thiếu/rỗng thì dừng publish để không tạo index một phần.
    async embed(inputs: string[]): Promise<number[][]> {
        // Đọc khóa ở server để credential không xuất hiện trong payload FE hoặc log request quản trị.
        const key = this.config.get<string>('OPENAI_API_KEY', '');
        // Từ chối sớm trước khi gọi mạng vì request không xác thực sẽ luôn thất bại và không thể tạo vector.
        if (!key)
            throw new ServiceUnavailableException(
                'Embedding provider chưa được cấu hình.',
            );

        // Gửi cả batch trong một request; model embedding biến mỗi input thành mảng số biểu diễn ngữ nghĩa.
        // Timeout giới hạn thời gian chờ để tác vụ publish không treo vô hạn khi provider không phản hồi.
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${key}`,
                'content-type': 'application/json',
            },
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({
                model: this.config.get<string>(
                    'EMBEDDING_MODEL',
                    'text-embedding-3-small',
                ),
                input: inputs,
            }),
        });
        // Không tiếp tục với body lỗi của provider vì dữ liệu đó không phải tập vector hợp lệ để ghi vào Qdrant.
        if (!response.ok)
            throw new ServiceUnavailableException(
                'Embedding provider không xử lý được tài liệu.',
            );

        // Provider trả mỗi vector kèm index đầu vào; kiểu cục bộ mô tả đúng phần response mà adapter cần dùng.
        const result = (await response.json()) as {
            data?: { index: number; embedding: number[] }[];
        };
        // Sắp xếp theo index gốc vì không nên phụ thuộc thứ tự phần tử trong response.
        // Việc giữ thứ tự là điều kiện để vector thứ i tiếp tục đi cùng chunk thứ i ở bước ghi Qdrant.
        const vectors = (result.data ?? [])
            .sort((a, b) => a.index - b.index)
            .map((item) => item.embedding);

        // Thiếu vector hoặc vector rỗng báo hiệu batch không đầy đủ; từ chối cả batch để tránh lệch chunk-vector.
        if (
            vectors.length !== inputs.length ||
            vectors.some((vector) => !Array.isArray(vector) || !vector.length)
        ) {
            throw new ServiceUnavailableException(
                'Embedding provider trả về dữ liệu không hợp lệ.',
            );
        }
        // Trả các vector đã được kiểm tra; caller chịu trách nhiệm gửi chúng tới vector index.
        return vectors;
    }
}
