// Các phép biến đổi evidence dùng chung cho answer pipeline; không thực hiện truy xuất hay quyết định quyền nguồn.
import type {
    SellerKnowledgeCitation,
    SellerKnowledgeSearchHit,
} from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';

// Hợp nhất nhóm retrieval theo thứ hạng từng task để ý phụ vẫn có evidence trước khi một task lấp đầy prompt.
export function selectSellerCopilotEvidence(
    rankedGroups: SellerKnowledgeSearchHit[][],
): SellerKnowledgeSearchHit[] {
    const uniqueHits: SellerKnowledgeSearchHit[] = [];
    const seenPointIds = new Set<string>();
    const maxRank = Math.max(
        0,
        ...rankedGroups.map((group) => group.length),
    );

    // Đi theo từng rank trên mọi task thay vì so sánh score giữa query khác nhau, vì score không cùng thang hiệu chuẩn.
    for (let rank = 0; rank < maxRank; rank += 1) {
        for (const group of rankedGroups) {
            const hit = group[rank];

            // Một point có thể xuất hiện ở nhiều truy vấn; chỉ giữ lần đầu theo thứ tự rank đã chọn.
            if (!hit || seenPointIds.has(hit.pointId)) continue;
            seenPointIds.add(hit.pointId);
            uniqueHits.push(hit);
        }
    }

    const perDocument = new Map<string, number>();

    // Giới hạn chunk trên mỗi tài liệu trước khi giới hạn tổng số để một tài liệu dài không độc quyền prompt.
    return uniqueHits
        .filter((hit) => {
            const count = perDocument.get(hit.documentId) ?? 0;

            // Hai chunk/tài liệu là mức tối đa hiện tại; hit dư bị bỏ mà không làm thay đổi thứ tự các tài liệu khác.
            if (count >= 2) return false;
            perDocument.set(hit.documentId, count + 1);
            return true;
        })
        .slice(0, 6);
}

// Chuyển hit đã được xác nhận thành provenance ổn định; excerpt chỉ dành cho preview, content giữ nguyên làm căn cứ audit.
export function mapSellerCopilotCitations(
    hits: SellerKnowledgeSearchHit[],
): SellerKnowledgeCitation[] {
    return hits.map((hit) => ({
        id: hit.pointId,
        label: `${hit.title} · ${hit.section}`,
        title: hit.title,
        sectionPath: hit.sectionPath,
        type: 'seller_knowledge',
        excerpt: hit.content.slice(0, 280),
        content: hit.content,
        documentId: hit.documentId,
        domain: hit.domainCode,
        version: hit.version,
    }));
}
