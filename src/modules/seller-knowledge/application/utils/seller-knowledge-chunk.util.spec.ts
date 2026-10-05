import { chunkSellerKnowledgeMarkdown } from '@/modules/seller-knowledge/application/utils/seller-knowledge-chunk.util';

// Kiểm tra chunk giữ lại cấu trúc ngữ nghĩa quan trọng để retrieval không mất tên mục con.
describe('chunkSellerKnowledgeMarkdown', () => {
    // Mục con có thể chứa điều kiện nghiệp vụ nên phải còn trong nội dung đưa đi embed.
    it('should preserve nested headings when splitting Markdown sections', () => {
        // Arrange
        const markdown = [
            '---',
            'title: Chính sách đổi trả',
            '---',
            '# Tổng quan',
            'Nội dung giới thiệu.',
            '## Điều kiện',
            '### Hàng còn nguyên trạng',
            'Sản phẩm cần đầy đủ tem nhãn và phụ kiện.',
        ].join('\n');

        // Act
        const chunks = chunkSellerKnowledgeMarkdown(markdown);

        // Assert
        expect(chunks).toEqual([
            {
                section: 'Nội dung chính',
                content: '# Tổng quan\nNội dung giới thiệu.',
            },
            {
                section: 'Điều kiện',
                content:
                    '### Hàng còn nguyên trạng\nSản phẩm cần đầy đủ tem nhãn và phụ kiện.',
            },
        ]);
    });

    // Một đoạn dài phải tạo nhiều chunk nhưng lặp lại một phần nội dung để giữ ngữ cảnh tại ranh giới.
    it('should create overlapping chunks for long section content', () => {
        // Arrange
        const paragraph =
            'Thông tin chính sách có ý nghĩa cần được giữ nguyên. '.repeat(45);
        const markdown = `## Quy trình\n${paragraph}`;

        // Act
        const chunks = chunkSellerKnowledgeMarkdown(markdown);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((chunk) => chunk.section === 'Quy trình')).toBe(
            true,
        );
        expect(chunks[0]?.content).toContain(
            chunks[1]?.content.slice(0, 80) ?? '',
        );
    });
});
