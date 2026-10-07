// Adapter ghi mỗi chunk cùng dense/sparse vector và metadata vào Qdrant để phục vụ hybrid retrieval.
// Adapter không quản lý Markdown gốc hoặc quyết định revision được dùng; PostgreSQL giữ nội dung nguồn và trạng thái chuẩn.
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { SellerKnowledgeVectorIndexPort } from '@/modules/seller-knowledge/application/ports/seller-knowledge-index.port';
import { fetchSellerKnowledgeWithRetry } from '@/modules/seller-knowledge/infrastructure/clients/seller-knowledge-fetch.util';
import type {
    SellerKnowledgeRetrievalIndexPort,
    SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

// Đóng gói giao tiếp HTTP với Qdrant; payload chứa nội dung chunk và metadata cần để lọc kết quả retrieval.
@Injectable()
export class QdrantSellerKnowledgeIndexClient
    implements SellerKnowledgeVectorIndexPort, SellerKnowledgeRetrievalIndexPort
{
    // Ghi nhớ collection đã chuẩn bị trong vòng đời provider để tránh tạo lại index trước mỗi lần publish.
    private readonly preparedCollections = new Set<string>();

    // Dùng cấu hình backend để lấy địa chỉ collection và khóa mà không nhận thông tin kết nối từ client.
    constructor(private readonly config: ConfigService) {}

    // Nhận một revision đã được chia chunk và vector của từng chunk; tạo một Qdrant point cho mỗi cặp chunk-vector.
    // Thứ tự an toàn là chuẩn bị collection, ghi toàn bộ points, xác minh ghi nhận rồi mới trả quyền cho service kích hoạt revision trong PostgreSQL.
    // Gặp lỗi cấu hình, vector sai kích thước, ghi thất bại hoặc không xác minh được thì ném lỗi để caller giữ revision cũ đang dùng.
    async publishRevision(
        input: Parameters<SellerKnowledgeVectorIndexPort['publishRevision']>[0],
    ): Promise<void> {
        // Bỏ dấu / cuối URL để các endpoint phía dưới được ghép đúng, kể cả cấu hình có dấu / dư.
        const base = (this.config.get<string>('QDRANT_URL') ?? '').replace(
            /\/$/u,
            '',
        );
        // Không gửi request tới URL rỗng; cấu hình thiếu là lỗi hạ tầng chứ không phải lỗi nội dung tài liệu.
        if (!base)
            throw new ServiceUnavailableException('Qdrant chưa được cấu hình.');

        // Cho phép đổi collection qua cấu hình, đồng thời có tên mặc định cho môi trường chưa khai báo riêng.
        const collection = this.getV2Collection();

        // Mọi request cần JSON; api-key chỉ thêm khi triển khai Qdrant có bật xác thực.
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };
        const apiKey = this.config.get<string>('QDRANT_API_KEY', '');
        if (apiKey) headers['api-key'] = apiKey;

        // Một point bắt buộc phải có chunk và vector tương ứng; từ chối batch lệch/rỗng trước mọi thao tác ghi.
        if (
            !input.chunks.length ||
            input.vectors.length !== input.chunks.length
        )
            throw new ServiceUnavailableException(
                'Số đoạn nội dung và vector embedding không khớp.',
            );

        // Collection Qdrant chỉ nhận vector cùng số chiều và giá trị hữu hạn; kiểm tra toàn batch trước khi ghi.
        const vectorSize = input.vectors[0]?.length;
        if (
            !vectorSize ||
            input.vectors.some(
                (vector) =>
                    vector.length !== vectorSize ||
                    vector.some((value) => !Number.isFinite(value)),
            )
        )
            throw new ServiceUnavailableException(
                'Embedding trả về vector không đồng nhất hoặc rỗng.',
            );

        // Khóa cache gồm URL, collection và số chiều để không dùng nhầm lần chuẩn bị của cấu hình khác.
        const preparationKey = `${base}/${collection}:${vectorSize}`;
        if (!this.preparedCollections.has(preparationKey)) {
            // Đảm bảo collection tồn tại và tương thích với vector trước; sau đó tạo metadata indexes dùng cho bộ lọc truy vấn.
            await this.ensureCollection(base, collection, headers, vectorSize);
            await this.ensurePayloadIndexes(base, collection, headers);
            // Chỉ đánh dấu đã chuẩn bị sau khi cả collection lẫn indexes đều thành công.
            this.preparedCollections.add(preparationKey);
        }

        // Chuyển từng chunk thành một point; ID băm ổn định theo revision, vị trí và nội dung để retry thay point cũ thay vì nhân bản.
        // Vector lấy cùng index với chunk vì adapter embedding bảo toàn thứ tự đầu vào.
        const points = input.chunks.map((chunk, index) => ({
            id: this.toUuid(
                createHash('sha256')
                    .update(`${input.revision.id}:${index}:${chunk.content}`)
                    .digest('hex'),
            ),
            vector: {
                dense: input.vectors[index]!,
                sparse: {
                    text: `${input.document.title}\n${chunk.sectionPath.join(' > ')}\n${chunk.content}`,
                    model: 'qdrant/bm25',
                    options: {
                        tokenizer: 'multilingual',
                        stemmer: { type: 'none' },
                        stopwords: {},
                    },
                },
            },
            payload: {
                // Các trường nhận diện giúp gom point về tài liệu, nhóm, ngôn ngữ và revision khi lọc/trả citation.
                documentId: input.document.id,
                title: input.document.title,
                domain: input.document.domainCode,
                domains: [input.document.domainCode],
                language: input.document.language,
                revisionId: input.revision.id,
                version: String(input.revision.revisionNumber),
                // indexed chỉ nói point đã được ghi; PostgreSQL mới là nguồn quyết định revision hiện hành.
                status: 'indexed',
                // Chuẩn hóa ngày thành ISO để Qdrant có thể lọc theo thời gian; null nghĩa là không đặt giới hạn tương ứng.
                effectiveFrom: this.toQdrantDate(input.document.effectiveFrom),
                effectiveTo: this.toQdrantDate(input.document.effectiveTo),
                // Giữ mục và nguyên văn chunk để truy xuất có ngữ cảnh và hiển thị đoạn làm căn cứ trả lời.
                section: chunk.sectionPath.join(' > '),
                sectionPath: chunk.sectionPath,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
            },
        }));

        // PUT points thực hiện upsert; wait=true yêu cầu Qdrant chờ thao tác ghi hoàn tất trước khi trả response.
        const response = await fetchSellerKnowledgeWithRetry(
            'Qdrant',
            'point upsert',
            () =>
                fetch(
                    `${base}/collections/${encodeURIComponent(collection)}/points?wait=true`,
                    {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({ points }),
                        signal: AbortSignal.timeout(30_000),
                    },
                ),
        );
        // Dừng ngay khi Qdrant từ chối upsert để service không đánh dấu revision đã publish.
        if (!response.ok)
            throw new ServiceUnavailableException(
                `Qdrant upsert failed (${response.status}).`,
            );

        // Đọc lại point đầu tiên làm xác nhận tối thiểu rằng dữ liệu có thể được truy cập sau upsert.
        // Nếu xác minh lỗi, caller vẫn chưa đổi con trỏ revision trong PostgreSQL.
        const verification = await fetchSellerKnowledgeWithRetry(
            'Qdrant',
            'point verification',
            () =>
                fetch(
                    `${base}/collections/${encodeURIComponent(collection)}/points/${points[0]!.id}`,
                    { headers, signal: AbortSignal.timeout(10_000) },
                ),
        );
        if (!verification.ok)
            throw new ServiceUnavailableException(
                'Không xác minh được vector sau khi lập chỉ mục.',
            );
        const verifiedPoint = (await verification.json()) as {
            result?: { id?: string | number } | null;
        };
        // Qdrant có thể trả HTTP 200 với result=null; chỉ coi index sẵn sàng khi point thực sự đọc lại được.
        if (String(verifiedPoint.result?.id) !== String(points[0]!.id))
            throw new ServiceUnavailableException(
                'Qdrant chưa thể đọc lại vector vừa lập chỉ mục.',
            );
    }

    // Đảm bảo collection tồn tại với metric Cosine và số chiều đúng bằng embedding hiện tại.
    // Nếu collection đã có thì đọc cấu hình để phát hiện model/dimension không tương thích trước khi upsert.
    private async ensureCollection(
        base: string,
        collection: string,
        headers: Record<string, string>,
        vectorSize: number,
    ): Promise<void> {
        // Thử đọc trước để không tạo lại collection đã tồn tại và giữ nguyên dữ liệu hiện có.
        const url = `${base}/collections/${encodeURIComponent(collection)}`;
        let response = await fetchSellerKnowledgeWithRetry(
            'Qdrant',
            'collection check',
            () =>
                fetch(url, {
                    headers,
                    signal: AbortSignal.timeout(10_000),
                }),
        );

        // Chỉ tạo collection khi Qdrant xác nhận chưa tồn tại; mọi lỗi đọc khác sẽ được xử lý ở bước kiểm tra bên dưới.
        if (response.status === 404) {
            response = await fetchSellerKnowledgeWithRetry(
                'Qdrant',
                'collection creation',
                () =>
                    fetch(url, {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({
                            vectors: {
                                dense: {
                                    size: vectorSize,
                                    distance: 'Cosine',
                                },
                            },
                            sparse_vectors: { sparse: { modifier: 'idf' } },
                        }),
                        signal: AbortSignal.timeout(20_000),
                    }),
            );
            // HTTP 409 có thể nghĩa là một publish đồng thời vừa tạo collection; đọc lại cấu hình để xác minh trạng thái thực.
            if (!response.ok && response.status !== 409)
                throw new ServiceUnavailableException(
                    `Qdrant collection creation failed (${response.status}).`,
                );
            // Luôn đọc lại sau tạo để cả tiến trình tạo mới lẫn tiến trình gặp race đều đi qua cùng bước xác minh.
            response = await fetchSellerKnowledgeWithRetry(
                'Qdrant',
                'collection verification',
                () =>
                    fetch(url, {
                        headers,
                        signal: AbortSignal.timeout(10_000),
                    }),
            );
        }

        // Nếu không đọc được collection sau bước trên thì không thể đảm bảo schema ghi vector an toàn.
        if (!response.ok)
            throw new ServiceUnavailableException(
                `Qdrant collection check failed (${response.status}).`,
            );

        // Chỉ giải mã phần response cần để đối chiếu vector size, tránh phụ thuộc vào các trường không dùng tới.
        const body = (await response.json()) as {
            result?: {
                config?: {
                    params?: {
                        vectors?: { dense?: { size?: number } };
                    };
                };
            };
        };
        // Từ chối mismatch vì Qdrant không thể nhận vector có chiều khác schema của collection.
        if (body.result?.config?.params?.vectors?.dense?.size !== vectorSize)
            throw new ServiceUnavailableException(
                'Kích thước vector không khớp collection Qdrant hiện tại.',
            );
    }

    // Tìm candidate chỉ trong revision allowlist do PostgreSQL vừa xác nhận; Qdrant không phải nguồn quyết định trạng thái tài liệu.
    // Hai prefetch dense/BM25 chạy độc lập rồi RRF hợp nhất thứ hạng; mỗi nhánh có trần riêng để chi phí/latency không tăng theo toàn corpus.
    // Chỉ tải payload cần rerank/citation; nội dung trả về là chunk đã index, không đọc Markdown gốc trong lúc chat.
    async search(input: {
        query: string;
        queryVector: number[];
        allowedRevisionIds: string[];
        limit: number;
        signal?: AbortSignal;
    }): Promise<SellerKnowledgeSearchHit[]> {
        if (!input.allowedRevisionIds.length) return [];
        // Vector query phải cùng dimension và chỉ chứa số hữu hạn; không gửi payload sai schema sang Qdrant.
        if (
            !input.queryVector.length ||
            input.queryVector.some((value) => !Number.isFinite(value))
        ) {
            throw new ServiceUnavailableException(
                'Vector truy vấn không hợp lệ.',
            );
        }
        const base = (this.config.get<string>('QDRANT_URL') ?? '').replace(
            /\/$/u,
            '',
        );
        if (!base)
            throw new ServiceUnavailableException('Qdrant chưa được cấu hình.');

        const collection = this.getV2Collection();
        const headers: Record<string, string> = {
            'content-type': 'application/json',
        };
        const apiKey = this.config.get<string>('QDRANT_API_KEY', '');
        if (apiKey) headers['api-key'] = apiKey;

        // MatchAny trên allowlist ngăn draft, archived và điểm legacy khỏi bị trả về dù metadata Qdrant còn sót.
        const eligibleRevisionFilter = {
            must: [
                {
                    key: 'revisionId',
                    match: { any: input.allowedRevisionIds },
                },
            ],
        };
        const candidateLimit = Math.max(
            1,
            Math.min(Math.floor(input.limit) || 1, 100),
        );
        // Mỗi nhánh dense/sparse có giới hạn độc lập trước fusion; cấu hình lỗi dùng fallback bounded thay vì mở rộng truy vấn.
        const perLegLimit = Number(
            this.config.get<string>(
                'SELLER_KNOWLEDGE_RETRIEVAL_PER_LEG_LIMIT',
                '40',
            ),
        );
        const boundedPerLegLimit = Number.isFinite(perLegLimit)
            ? Math.max(1, Math.min(Math.floor(perLegLimit), 100))
            : 40;
        // Query API áp cùng revision filter lên cả hai retriever trước fusion để chunk stale không được ưu tiên rồi mới loại ở app.
        const response = await fetch(
            `${base}/collections/${encodeURIComponent(collection)}/points/query`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    prefetch: [
                        {
                            query: input.queryVector,
                            using: 'dense',
                            filter: eligibleRevisionFilter,
                            limit: boundedPerLegLimit,
                        },
                        {
                            query: {
                                text: input.query,
                                model: 'qdrant/bm25',
                                options: {
                                    tokenizer: 'multilingual',
                                    stemmer: { type: 'none' },
                                    stopwords: {},
                                },
                            },
                            using: 'sparse',
                            filter: eligibleRevisionFilter,
                            limit: boundedPerLegLimit,
                        },
                    ],
                    query: { rrf: {} },
                    limit: candidateLimit,
                    with_payload: [
                        'documentId',
                        'title',
                        'domain',
                        'language',
                        'revisionId',
                        'version',
                        'effectiveFrom',
                        'effectiveTo',
                        'section',
                        'sectionPath',
                        'chunkIndex',
                        'content',
                    ],
                }),
                signal: input.signal
                    ? AbortSignal.any([
                          input.signal,
                          AbortSignal.timeout(15_000),
                      ])
                    : AbortSignal.timeout(15_000),
            },
        );
        if (!response.ok)
            throw new ServiceUnavailableException(
                `Qdrant hybrid search failed (${response.status}).`,
            );

        const body = (await response.json()) as {
            result?: {
                points?: {
                    id: string | number;
                    score: number;
                    payload?: Record<string, unknown>;
                }[];
            };
        };
        // Mảng rỗng là “không tìm thấy”; response thiếu cấu trúc hoặc payload sai bị coi là lỗi để không biến lỗi index thành câu trả lời thiếu căn cứ.
        if (!Array.isArray(body.result?.points))
            throw new ServiceUnavailableException(
                'Qdrant trả về kết quả tìm kiếm không hợp lệ.',
            );
        return body.result.points.flatMap((point) => {
            const payload = point.payload;
            // Bỏ payload thiếu nội dung/ID thay vì tạo citation không thể kiểm chứng ở bước sinh đáp án.
            if (
                typeof payload?.documentId !== 'string' ||
                typeof payload.revisionId !== 'string' ||
                typeof payload.title !== 'string' ||
                typeof payload.domain !== 'string' ||
                typeof payload.section !== 'string' ||
                typeof payload.content !== 'string' ||
                typeof payload.version !== 'string' ||
                !Number.isFinite(point.score) ||
                (typeof point.id !== 'string' && typeof point.id !== 'number')
            ) {
                return [];
            }
            // Metadata tùy chọn được chuẩn hóa; sectionPath lỗi dùng section để citation vẫn có nhãn hiển thị.
            return [
                {
                    pointId: String(point.id),
                    documentId: payload.documentId,
                    revisionId: payload.revisionId,
                    title: payload.title,
                    domainCode: payload.domain,
                    language:
                        typeof payload.language === 'string'
                            ? payload.language
                            : 'vi',
                    effectiveFrom:
                        typeof payload.effectiveFrom === 'string'
                            ? payload.effectiveFrom
                            : null,
                    effectiveTo:
                        typeof payload.effectiveTo === 'string'
                            ? payload.effectiveTo
                            : null,
                    section: payload.section,
                    sectionPath: Array.isArray(payload.sectionPath)
                        ? payload.sectionPath.filter(
                              (part): part is string =>
                                  typeof part === 'string',
                          )
                        : [payload.section],
                    content: payload.content,
                    score: point.score,
                    version: payload.version,
                },
            ];
        });
    }

    // Tách tên collection v2 khỏi biến legacy để lệnh ingest static cũ không vô tình ghi corpus vào collection mới.
    private getV2Collection(): string {
        return this.config.get<string>(
            'QDRANT_COLLECTION_SELLER_KNOWLEDGE_V2',
            'seller_knowledge_v2',
        );
    }

    // Tạo index payload cho các trường thường dùng để lọc revision, domain, ngôn ngữ và thời hạn hiệu lực.
    // Lỗi index dừng publish để collection mới không âm thầm thiếu khả năng lọc an toàn.
    private async ensurePayloadIndexes(
        base: string,
        collection: string,
        headers: Record<string, string>,
    ): Promise<void> {
        // Retrieval hiện chỉ lọc theo allowlist revision; các metadata khác được PostgreSQL kiểm tra nên chưa cần index tốn RAM.
        for (const fieldName of ['revisionId']) {
            // Tạo index keyword cần thiết cho bộ lọc an toàn; lỗi phải dừng publish trước khi upsert point.
            const response = await fetchSellerKnowledgeWithRetry(
                'Qdrant',
                `payload index creation (${fieldName})`,
                () =>
                    fetch(
                        `${base}/collections/${encodeURIComponent(collection)}/index`,
                        {
                            method: 'PUT',
                            headers,
                            body: JSON.stringify({
                                field_name: fieldName,
                                field_schema: 'keyword',
                            }),
                            signal: AbortSignal.timeout(10_000),
                        },
                    ),
            );
            // 409 thường báo index đã tồn tại, phù hợp với thao tác lặp; status lỗi khác phải được báo ra.
            if (!response.ok && response.status !== 409)
                throw new ServiceUnavailableException(
                    `Qdrant payload index failed for ${fieldName} (${response.status}).`,
                );
        }
    }

    // Đổi ngày nghiệp vụ YYYY-MM-DD thành mốc UTC đầu ngày theo định dạng Qdrant filter yêu cầu; null giữ nghĩa không giới hạn.
    private toQdrantDate(value: string | null): string | null {
        return value ? `${value}T00:00:00Z` : null;
    }

    // Lấy 128 bit đầu của SHA-256 và đặt các bit version/variant để tạo UUID hợp lệ mà vẫn có tính ổn định.
    // Cùng revision, vị trí và nội dung cho cùng ID; retry vì vậy upsert lại đúng point thay vì tạo bản trùng.
    private toUuid(hash: string): string {
        // UUID v4 yêu cầu version nibble là 4 và variant bits là 10; các bit khác giữ từ hash để ID ổn định.
        const hex = hash.slice(0, 32).split('');
        hex[12] = '4';
        hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
        const value = hex.join('');
        return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
    }
}
