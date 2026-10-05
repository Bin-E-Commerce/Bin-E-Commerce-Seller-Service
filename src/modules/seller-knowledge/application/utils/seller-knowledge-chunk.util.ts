// Chia Markdown thành các chunk có tên mục để embedding/retrieval giữ ngữ cảnh và citation chỉ đúng phần nội dung.
// Utility thuần chỉ biến đổi chuỗi; giới hạn kích thước/overlap là hợp đồng với bước embedding, không thực hiện I/O.
const CHUNK_LENGTH = 1400;
const CHUNK_OVERLAP = 200;

export interface SellerKnowledgeChunk {
    section: string;
    content: string;
}

// Bỏ frontmatter vì metadata đã được lưu riêng, sau đó chia theo heading cấp 2 để mỗi chunk gắn đúng section.
// Heading sâu hơn được giữ trong body; phần không có heading cấp 2 vẫn được gom vào mục mặc định.
export function chunkSellerKnowledgeMarkdown(
    markdown: string,
): SellerKnowledgeChunk[] {
    // Loại block metadata YAML đầu file nếu có; không loại các dấu --- khác nằm trong nội dung thân bài.
    const clean = markdown.replace(/^---\s*[\s\S]*?^---\s*/mu, '').trim();
    // Lookahead giữ nguyên heading trong phần tương ứng, tránh làm mất tên mục khi tách section.
    const sections = clean.split(/(?=^##\s+)/mu);

    // Chuyển từng section độc lập để chunk không trộn nội dung của hai chủ đề khác nhau.
    return sections.flatMap((sectionText) => {
        const section =
            sectionText.match(/^##\s+(.+)$/mu)?.[1]?.trim() ?? 'Nội dung chính';
        const content = sectionText.replace(/^##\s+.+$/mu, '').trim();

        return splitSection(section, content);
    });
}

// Tạo cửa sổ tối đa CHUNK_LENGTH, ưu tiên ngắt ở đoạn/câu để hạn chế cắt đôi quy tắc.
// Nếu văn bản không có ranh giới phù hợp thì cắt cứng để bảo đảm kích thước có giới hạn; chunk kế tiếp lặp lại overlap.
function splitSection(
    section: string,
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
        if (chunkContent) chunks.push({ section, content: chunkContent });
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
