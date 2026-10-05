// CLI nạp các Markdown tĩnh được công bố trước đó thành chunk/vector trong Qdrant; không ghi projection policy vào PostgreSQL.
// sourcePath chỉ dùng nội bộ để báo lỗi file trùng; payload Qdrant không chứa đường dẫn file nguồn.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { join, relative, resolve } from 'node:path';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.util';

interface KnowledgeChunk {
    id: string;
    documentId: string;
    title: string;
    section: string;
    content: string;
    // Đường dẫn cục bộ chỉ để phát hiện document/version khai báo từ nhiều file; không gửi trường này lên Qdrant.
    sourcePath: string;
    domain: string;
    domains: string[];
    version: string;
    language: string;
    status:
        'draft' | 'review' | 'published' | 'expired' | 'archived' | 'missing';
    effectiveFrom: string | null;
    effectiveTo: string | null;
}

interface KnowledgeFrontmatter {
    documentId: string;
    title: string;
    domain: string;
    language: string;
    version: string;
    status: KnowledgeChunk['status'];
    effectiveFrom: string | null;
    effectiveTo: string | null;
    sourceType: string;
    sourceRef: string;
}

const root = process.cwd();

// CLI chạy được cả từ workspace seller-service, repository root và container.
// Chỉ nạp file môi trường khi biến chưa được inject sẵn để Docker/Kubernetes luôn
// giữ quyền ưu tiên cấu hình runtime, còn local vẫn có thể chạy validate/ingest.
for (const envFile of [
    join(root, '.env.local'),
    join(root, '.env'),
    join(root, '..', '..', '.env'),
]) {
    if (existsSync(envFile)) loadEnvFile(envFile);
}

const inputArg = process.argv.find((value) => value.startsWith('--input='));
const inputDirectory = inputArg
    ? resolve(root, inputArg.slice('--input='.length))
    : existsSync(join(root, 'data', 'seller-knowledge'))
      ? join(root, 'data', 'seller-knowledge')
      : join(root, 'services', 'seller-service', 'data', 'seller-knowledge');
const qdrantUrl = (process.env.QDRANT_URL ?? '').replace(/\/$/u, '');
const qdrantKey = process.env.QDRANT_API_KEY ?? '';
const collection =
    process.env.QDRANT_COLLECTION_SELLER_KNOWLEDGE ?? 'seller_knowledge_v1';
const embeddingModel = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
const openAiKey = process.env.OPENAI_API_KEY ?? '';
const datasetVersion =
    process.env.SELLER_KNOWLEDGE_DATASET_VERSION ?? 'seller-knowledge-v1';
const embeddingBatchSize = Math.max(
    1,
    Number(process.env.SELLER_KNOWLEDGE_EMBEDDING_BATCH_SIZE ?? 50) || 50,
);
const networkRetryCount = 3;
const networkRetryDelayMs = 250;
const dryRun = process.argv.includes('--dry-run');
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (qdrantKey) headers['api-key'] = qdrantKey;

// CLI đọc file Markdown, kiểm tra toàn bộ metadata/domain/version trước khi gọi dịch vụ ngoài.
// Qdrant là nguồn retrieval duy nhất; PostgreSQL không còn được ghi projection policy.
// Dataset cũ chỉ bị dọn sau khi dataset mới đã upsert đủ points để tránh mất evidence.
async function main(): Promise<void> {
    // Dry-run chỉ kiểm tra file/metadata nên không bắt buộc khóa provider hay địa chỉ Qdrant.
    if (!dryRun && !openAiKey)
        throw new Error('OPENAI_API_KEY is required for knowledge ingestion.');
    if (!dryRun && !qdrantUrl)
        throw new Error('QDRANT_URL is required for knowledge ingestion.');

    // Chỉ duyệt file Markdown trong thư mục đã chọn, sau đó validate mọi file trước khi bỏ qua draft.
    const files = (await readdir(inputDirectory)).filter((file) =>
        file.endsWith('.md'),
    );
    await validatePolicyFiles(files);
    // Đọc/chia file song song để tăng tốc I/O; flat gom các phần thành một batch nhất quán cho dataset.
    const chunks = (
        await Promise.all(files.map((file) => readChunks(file)))
    ).flat();
    if (chunks.length === 0) {
        throw new Error(
            `No published markdown files found in ${inputDirectory}.`,
        );
    }
    validateDocumentVersions(chunks);

    // Dry-run dừng trước embedding/Qdrant để người vận hành kiểm tra cấu trúc mà không phát sinh chi phí hoặc ghi dữ liệu.
    if (dryRun) {
        console.log(
            `Validated ${chunks.length} published seller knowledge chunks for ${datasetVersion}.`,
        );
        return;
    }

    // Sinh một vector cho mỗi chunk và kiểm tra count trước khi ghép cặp; thiếu vector sẽ làm sai nội dung point.
    const embeddings = await createEmbeddings(
        chunks.map(buildKnowledgeEmbeddingInput),
    );
    if (embeddings.length !== chunks.length) {
        throw new Error(
            `Embedding count mismatch: expected ${chunks.length}, received ${embeddings.length}.`,
        );
    }
    // Chuẩn bị schema collection/index trước khi dựng payload; size lấy từ model thực tế nếu batch có vector.
    await ensureCollection(embeddings[0]?.length ?? 1536);
    await ensurePayloadIndexes();
    const points = chunks.map((chunk, index) => ({
        id: chunk.id,
        vector: embeddings[index],
        payload: {
            documentId: chunk.documentId,
            title: chunk.title,
            section: chunk.section,
            content: chunk.content,
            domain: chunk.domain,
            domains: chunk.domains,
            version: chunk.version,
            language: chunk.language,
            status: chunk.status,
            effectiveFrom: toQdrantDate(chunk.effectiveFrom),
            effectiveTo: toQdrantDate(chunk.effectiveTo),
            datasetVersion,
        },
    }));

    // Upsert dataset mới trước; chỉ sau thành công mới reconcile chunk cũ và xóa dataset version cũ.
    const response = await fetchWithRetry(
        `${qdrantUrl}/collections/${encodeURIComponent(collection)}/points?wait=true`,
        {
            method: 'PUT',
            headers,
            body: JSON.stringify({ points }),
        },
    );
    if (!response.ok)
        throw new Error(`Qdrant upsert failed: ${response.status}`);
    await reconcileCurrentDataset(chunks);
    await cleanupPreviousDatasetVersions();
    console.log(
        `Ingested ${points.length} seller knowledge chunks into ${collection} (${datasetVersion}).`,
    );
}

// Đưa title và section vào cùng vector với content để câu hỏi diễn đạt theo ý nghĩa
// vẫn tìm được rule đúng dù không lặp nguyên tiêu đề tài liệu. Payload vẫn giữ content
// sạch để citation hiển thị đúng phần Markdown, không làm lộ chuỗi embedding phụ trợ.
function buildKnowledgeEmbeddingInput(chunk: KnowledgeChunk): string {
    return [chunk.title, chunk.section, chunk.content]
        .filter(Boolean)
        .join('\n');
}

// Xóa chunk cũ còn sót trong cùng dataset version sau khi source Markdown bị sửa.
// Upsert chỉ thay point có cùng ID; chunk đổi nội dung sẽ có ID mới nên cần filter
// has_id để Qdrant không trả evidence cũ đã bị loại khỏi source Markdown.
async function reconcileCurrentDataset(
    chunks: KnowledgeChunk[],
): Promise<void> {
    const response = await fetchWithRetry(
        `${qdrantUrl}/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                filter: {
                    must: [
                        {
                            key: 'datasetVersion',
                            match: { value: datasetVersion },
                        },
                    ],
                    must_not: [{ has_id: chunks.map((chunk) => chunk.id) }],
                },
            }),
        },
    );
    if (!response.ok) {
        throw new Error(
            `Qdrant current dataset reconciliation failed: ${response.status}`,
        );
    }
}

// Chia tài liệu theo heading trước, sau đó dùng cửa sổ có overlap để một rule
// vẫn giữ được điều kiện và ngoại lệ gần nhau. Mỗi ID phụ thuộc document/version,
// vị trí và nội dung nên ingest lại cùng nguồn sẽ upsert idempotent thay vì tạo rác.
async function readChunks(fileName: string): Promise<KnowledgeChunk[]> {
    const filePath = join(inputDirectory, fileName);
    const source = await readFile(filePath, 'utf8');
    const { frontmatter, markdown } = parseFrontmatter(source, fileName);
    if (frontmatter.status !== 'published') return [];
    const title = frontmatter.title;
    const sections = markdown.split(/\n(?=##\s)/u);
    return sections.flatMap((sectionText, sectionIndex) => {
        const section =
            sectionText.match(/^##\s+(.+)$/m)?.[1]?.trim() ?? 'Overview';
        const content = sectionText.replace(/^#.*$/gm, '').trim();
        if (!content) return [];
        const pieces: KnowledgeChunk[] = [];
        for (let offset = 0; offset < content.length; offset += 1200) {
            const piece = content.slice(offset, offset + 1400).trim();
            if (!piece) continue;
            const digest = createHash('sha256')
                .update(
                    `${frontmatter.documentId}:${frontmatter.version}:${sectionIndex}:${offset}:${piece}`,
                )
                .digest('hex')
                .slice(0, 32);
            const chunk: KnowledgeChunk = {
                id: digest,
                documentId: frontmatter.documentId,
                title,
                section,
                content: piece,
                sourcePath: relative(root, filePath),
                domain: frontmatter.domain,
                domains: [frontmatter.domain],
                version: frontmatter.version,
                language: frontmatter.language,
                status: frontmatter.status,
                effectiveFrom: frontmatter.effectiveFrom,
                effectiveTo: frontmatter.effectiveTo,
            };
            pieces.push(chunk);
            if (offset + 1400 >= content.length) break;
        }
        return pieces;
    });
}

// Chặn duplicate document/version trong các chunk published như lớp bảo vệ thứ hai.
// Lớp validate metadata phía trên còn kiểm tra draft/missing để lỗi không bị che bởi
// việc readChunks bỏ qua những file chưa được phép activate.
function validateDocumentVersions(chunks: KnowledgeChunk[]): void {
    const seen = new Map<string, string>();
    for (const chunk of chunks) {
        const key = `${chunk.documentId}:${chunk.version}`;
        const previousPath = seen.get(key);
        if (previousPath && previousPath !== chunk.sourcePath)
            throw new Error(`Duplicate documentId/version found: ${key}.`);
        seen.set(key, chunk.sourcePath);
    }
}

// Kiểm tra identity của mọi policy file trước khi lọc status published.
// Nếu draft và published cùng document/version, ingestion vẫn phải dừng vì
// version đó không còn có một nguồn duy nhất để review và audit.
async function validatePolicyFiles(files: string[]): Promise<void> {
    const registryContent = await readFile(
        join(inputDirectory, 'capability-registry.json'),
        'utf8',
    );
    const registry = validateSellerQuestionCapabilityRegistry(
        JSON.parse(registryContent) as unknown,
    );
    const registeredDomains = new Set(
        registry.domains.map((domain) => domain.code),
    );
    const seen = new Map<string, string>();
    for (const fileName of files) {
        const source = await readFile(join(inputDirectory, fileName), 'utf8');
        const { frontmatter } = parseFrontmatter(source, fileName);
        if (!registeredDomains.has(frontmatter.domain)) {
            throw new Error(
                `Unregistered seller knowledge domain "${frontmatter.domain}" in ${fileName}; add the domain to capability-registry.json first.`,
            );
        }
        const key = `${frontmatter.documentId}:${frontmatter.version}`;
        const previousFile = seen.get(key);
        if (previousFile && previousFile !== fileName) {
            throw new Error(
                `Duplicate documentId/version found: ${key} in ${previousFile} and ${fileName}.`,
            );
        }
        seen.set(key, fileName);
    }
}

// Qdrant cần datetime ISO để range filter và citation luôn hiển thị ngày hợp lệ.
function toQdrantDate(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()))
        throw new Error(`Invalid policy effective date: ${value}.`);
    return date.toISOString();
}

// Đọc frontmatter bằng parser nội bộ để ingestion không phụ thuộc package runtime.
// File không có metadata được coi là draft; file published phải khai báo đủ nguồn,
// ngôn ngữ và effective date để runtime có thể filter, citation và audit chính xác.
function parseFrontmatter(
    source: string,
    fileName: string,
): { frontmatter: KnowledgeFrontmatter; markdown: string } {
    const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/u);
    if (!match) {
        return {
            frontmatter: {
                documentId: fileName.replace(/\.md$/u, ''),
                title: fileName,
                domain: 'unclassified',
                language: 'vi',
                version: 'unversioned',
                status: 'draft',
                effectiveFrom: null,
                effectiveTo: null,
                sourceType: 'unknown',
                sourceRef: fileName,
            },
            markdown: source,
        };
    }

    const values = new Map<string, string>();
    for (const line of (match[1] ?? '').split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        values.set(
            line.slice(0, separator).trim(),
            line.slice(separator + 1).trim(),
        );
    }
    const status = values.get('status') as KnowledgeChunk['status'] | undefined;
    if (
        !status ||
        ![
            'draft',
            'review',
            'published',
            'expired',
            'archived',
            'missing',
        ].includes(status)
    ) {
        throw new Error(`Invalid policy status in ${fileName}.`);
    }
    const required = ['documentId', 'title', 'domain', 'version'];
    if (status === 'published') {
        required.push('language', 'effectiveFrom', 'sourceType', 'sourceRef');
    }
    for (const key of required) {
        if (!values.get(key)) throw new Error(`Missing ${key} in ${fileName}.`);
    }

    const effectiveFrom = values.get('effectiveFrom') || null;
    const effectiveTo = values.get('effectiveTo') || null;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
    if (
        status === 'published' &&
        (!effectiveFrom || !datePattern.test(effectiveFrom))
    ) {
        throw new Error(`Invalid effectiveFrom in ${fileName}.`);
    }
    if (effectiveTo && !datePattern.test(effectiveTo)) {
        throw new Error(`Invalid effectiveTo in ${fileName}.`);
    }

    return {
        frontmatter: {
            documentId: values.get('documentId')!,
            title: values.get('title')!,
            domain: values.get('domain')!,
            language: values.get('language') ?? 'vi',
            version: values.get('version')!,
            status: status as KnowledgeChunk['status'],
            effectiveFrom,
            effectiveTo,
            sourceType: values.get('sourceType') ?? 'internal-policy',
            sourceRef: values.get('sourceRef') ?? fileName,
        },
        markdown: match[2] ?? '',
    };
}

// Embedding theo batch để giảm số request OpenAI và tránh payload lớn khi knowledge base tăng.
// Kết quả được sắp xếp theo index của API vì thứ tự response không nên được giả định;
// nếu số lượng vector không khớp, main sẽ dừng trước khi ghi Qdrant.
async function createEmbeddings(inputs: string[]): Promise<number[][]> {
    const result: number[][] = [];
    for (let offset = 0; offset < inputs.length; offset += embeddingBatchSize) {
        const batch = inputs.slice(offset, offset + embeddingBatchSize);
        const response = await fetchWithRetry(
            'https://api.openai.com/v1/embeddings',
            {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${openAiKey}`,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ model: embeddingModel, input: batch }),
            },
        );
        if (!response.ok)
            throw new Error(`OpenAI embedding failed: ${response.status}`);
        const body = (await response.json()) as {
            data?: Array<{ index: number; embedding: number[] }>;
        };
        result.push(
            ...(body.data ?? [])
                .sort((left, right) => left.index - right.index)
                .map((item) => item.embedding),
        );
    }
    return result;
}

// Xóa dataset cũ sau khi dataset mới đã upsert thành công; query runtime luôn dùng
// datasetVersion hiện hành. Không xóa trước upsert để một lần ingest lỗi không làm
// collection active mất toàn bộ evidence.
async function cleanupPreviousDatasetVersions(): Promise<void> {
    const response = await fetchWithRetry(
        `${qdrantUrl}/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                filter: {
                    must_not: [
                        {
                            key: 'datasetVersion',
                            match: { value: datasetVersion },
                        },
                    ],
                },
            }),
        },
    );
    if (!response.ok) {
        throw new Error(
            `Qdrant old dataset cleanup failed: ${response.status}`,
        );
    }
}

// Tạo collection lần đầu theo đúng dimensions của embedding model hiện tại.
async function ensureCollection(size: number): Promise<void> {
    const check = await fetchWithRetry(
        `${qdrantUrl}/collections/${encodeURIComponent(collection)}`,
        { headers },
    );
    if (check.ok) return;
    const response = await fetchWithRetry(
        `${qdrantUrl}/collections/${encodeURIComponent(collection)}`,
        {
            method: 'PUT',
            headers,
            body: JSON.stringify({ vectors: { size, distance: 'Cosine' } }),
        },
    );
    if (!response.ok)
        throw new Error(
            `Qdrant collection creation failed: ${response.status}`,
        );
}

// Tạo payload index cho các field được filter thường xuyên, giảm latency khi collection lớn lên.
async function ensurePayloadIndexes(): Promise<void> {
    for (const fieldName of [
        'status',
        'language',
        'domain',
        'domains',
        'datasetVersion',
        'effectiveFrom',
        'effectiveTo',
    ]) {
        const response = await fetchWithRetry(
            `${qdrantUrl}/collections/${encodeURIComponent(collection)}/index`,
            {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    field_name: fieldName,
                    field_schema:
                        fieldName === 'effectiveFrom' ||
                        fieldName === 'effectiveTo'
                            ? 'datetime'
                            : 'keyword',
                }),
            },
        );
        if (!response.ok && response.status !== 409) {
            throw new Error(
                `Qdrant payload index failed for ${fieldName}: ${response.status}`,
            );
        }
    }
}

// Retry ngắn cho lỗi mạng, 429 và 5xx; lỗi 4xx còn lại trả thẳng để người vận hành
// sửa cấu hình hoặc payload. Request upsert dùng point ID ổn định nên chạy lại vẫn idempotent.
async function fetchWithRetry(
    url: string,
    init: RequestInit,
): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < networkRetryCount; attempt += 1) {
        try {
            const response = await fetch(url, init);
            if (
                response.ok ||
                ![429, 500, 502, 503, 504].includes(response.status) ||
                attempt === networkRetryCount - 1
            ) {
                return response;
            }
        } catch (error) {
            lastError = error;
            if (attempt === networkRetryCount - 1) throw error;
        }
        await new Promise((resolve) =>
            setTimeout(resolve, networkRetryDelayMs * (attempt + 1)),
        );
    }
    throw lastError instanceof Error
        ? lastError
        : new Error('Knowledge provider request failed.');
}

void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
