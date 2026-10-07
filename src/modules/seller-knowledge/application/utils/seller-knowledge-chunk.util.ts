// Chia Markdown thành các chunk có tên mục để embedding/retrieval giữ ngữ cảnh và citation chỉ đúng phần nội dung.
// Utility thuần chỉ biến đổi chuỗi; giới hạn kích thước/overlap là hợp đồng với bước embedding, không thực hiện I/O.
const CHUNK_LENGTH = 1800;
const CHUNK_OVERLAP = 240;

export interface SellerKnowledgeChunk {
    section: string;
    sectionPath: string[];
    content: string;
    chunkIndex: number;
}

// Bỏ frontmatter vì metadata đã được lưu riêng, sau đó chia theo heading cấp 2 để mỗi chunk gắn đúng section.
// Heading sâu hơn được giữ trong body; phần không có heading cấp 2 vẫn được gom vào mục mặc định.
export function chunkSellerKnowledgeMarkdown(
    markdown: string,
): SellerKnowledgeChunk[] {
    // Loại block metadata YAML đầu file nếu có; không loại các dấu --- khác nằm trong nội dung thân bài.
    const clean = markdown.replace(/^---\s*[\s\S]*?^---\s*/mu, '').trim();
    const headings: string[] = [];
    const chunks: SellerKnowledgeChunk[] = [];
    let currentBlocks: string[] = [];

    // Xả nội dung theo từng nhánh heading; giữ bảng/danh sách liền mạch để chunk không cắt cấu trúc Markdown.
    const flushSection = () => {
        const sectionPath = headings.filter(Boolean);
        const section = sectionPath.at(-1) ?? 'Nội dung chính';
        const content = currentBlocks.join('\n\n').trim();
        if (content) {
            chunks.push(
                ...splitSection(section, sectionPath, content).map(
                    (chunk, sectionChunkIndex) => ({
                        ...chunk,
                        chunkIndex: chunks.length + sectionChunkIndex + 1,
                    }),
                ),
            );
        }
        currentBlocks = [];
    };

    // Tách heading ở mọi cấp và lưu đường dẫn cha-con; heading được ghi riêng trong sectionPath thay vì lặp sai cấp.
    for (const line of clean.split(/\r?\n/u)) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
        if (headingMatch) {
            flushSection();
            const depth = headingMatch[1]!.length;
            headings.length = depth - 1;
            headings[depth - 1] = headingMatch[2]!.trim();
            continue;
        }
        if (!line.trim()) {
            if (currentBlocks.length && currentBlocks.at(-1) !== '') {
                currentBlocks.push('');
            }
            continue;
        }
        currentBlocks.push(line);
    }
    flushSection();
    return chunks;
}

// Tạo cửa sổ tối đa CHUNK_LENGTH, ưu tiên ngắt ở đoạn/câu để hạn chế cắt đôi quy tắc.
// Nếu văn bản không có ranh giới phù hợp thì cắt cứng để bảo đảm kích thước có giới hạn; chunk kế tiếp lặp lại overlap.
function splitSection(
    section: string,
    sectionPath: string[],
    content: string,
): SellerKnowledgeChunk[] {
    const chunks: SellerKnowledgeChunk[] = [];
    let start = 0;

    while (start < content.length) {
        // hardEnd chặn chunk không vượt giới hạn, đồng thời kết thúc đúng cuối nội dung nếu đoạn còn lại ngắn hơn.
        const hardEnd = Math.min(start + CHUNK_LENGTH, content.length);
        let end = hardEnd;
        // Chỉ tìm ranh giới mềm khi còn nội dung phía sau; chunk cuối dùng thẳng cuối chuỗi.
        if (hardEnd < content.length) {
            const paragraphEnd = content.lastIndexOf('\n\n', hardEnd);
            const sentenceEnd = Math.max(
                content.lastIndexOf('. ', hardEnd),
                content.lastIndexOf('? ', hardEnd),
                content.lastIndexOf('! ', hardEnd),
            );
            // Chọn điểm ngắt sau ít nhất nửa cửa sổ để tránh chunk quá ngắn; ưu tiên paragraph rồi sentence.
            const boundary =
                paragraphEnd > start + CHUNK_LENGTH / 2
                    ? paragraphEnd
                    : sentenceEnd > start + CHUNK_LENGTH / 2
                      ? sentenceEnd + 1
                      : hardEnd;
            end = boundary;
        }

        // Trim khoảng trắng ở ranh giới; bỏ chunk rỗng để không gửi input vô nghĩa đi embed.
        const chunkContent = content.slice(start, end).trim();
        if (chunkContent) {
            chunks.push({
                section,
                sectionPath,
                content: chunkContent,
                chunkIndex: 0,
            });
        }
        if (end >= content.length) break;

        // Overlap giữ lại ngữ cảnh gần ranh giới để truy vấn tìm được điều kiện/ngoại lệ ở hai chunk liên tiếp.
        // Lùi tối đa CHUNK_OVERLAP nhưng không đứng yên; sau đó dịch tới khoảng trắng nếu còn trong chunk vừa xử lý.
        const overlapStart = Math.max(start + 1, end - CHUNK_OVERLAP);
        const nextWord = content.indexOf(' ', overlapStart);
        start =
            nextWord > overlapStart && nextWord < end
                ? nextWord + 1
                : overlapStart;
    }

    return chunks;
}
