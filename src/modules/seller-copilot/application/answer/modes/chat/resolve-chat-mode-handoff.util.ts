// Chuyển yêu cầu nghiệp vụ khỏi Chat bằng plan đã xác thực; hàm này không đọc nguồn hay thực hiện thao tác.
import type { SellerKnowledgeDomainKind } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import type { SellerQuestionTask } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';

const CAPABILITY_REPLY =
    'Mình có 4 chế độ để bạn chọn đúng nhu cầu: Trò chuyện để trao đổi chung; Dữ liệu shop để xem doanh thu, đơn hàng, sản phẩm, tồn kho và hồ sơ; Tài liệu để tra chính sách, hướng dẫn đã được cung cấp; AI Agent để thực hiện các thao tác đang hỗ trợ, với bước xem lại và xác nhận trước khi áp dụng. 🙂';

// Chỉ trả hướng dẫn mode khi plan cho thấy cần dữ liệu hoặc thao tác seller; SMALL_TALK vẫn đi tới answer model.
// Registry quyết định loại nguồn, còn CHANGE_REQUEST luôn cần Agent dù task đó thuộc domain nào.
// Khi câu có nhiều nhu cầu, gom các mode đích để người dùng biết cần chuyển mode nào mà không truy cập bất kỳ nguồn nào.
export function resolveChatModeHandoff(
    tasks: SellerQuestionTask[],
    domainKinds: Map<string, SellerKnowledgeDomainKind>,
): string | null {
    // Câu hỏi về khả năng của sản phẩm không cần shop data; trả thông tin mode tĩnh, không gọi LLM để tự đoán capability.
    if (
        tasks.length > 0 &&
        tasks.every(
            (task) =>
                task.requestType === 'CAPABILITY_QUERY' ||
                task.requestType === 'SMALL_TALK',
        ) &&
        tasks.some((task) => task.requestType === 'CAPABILITY_QUERY')
    ) {
        return CAPABILITY_REPLY;
    }

    // Chỉ cần một yêu cầu ghi là phải chuyển Agent; tuyệt đối không để phần còn lại chạy trong Chat.
    if (tasks.some((task) => task.requestType === 'CHANGE_REQUEST')) {
        return 'Yêu cầu này cần thao tác trên shop nên chưa thể xử lý trong chế độ Trò chuyện. Bạn chuyển sang AI Agent rồi gửi lại yêu cầu nhé 🙂.';
    }

    // Đọc loại nguồn từ registry đã được backend xác thực thay vì dò từ khóa trong câu hỏi.
    const requiredKinds = new Set(
        tasks
            .filter((task) => task.requestType === 'READ_QUERY')
            .map((task) => domainKinds.get(task.domain ?? ''))
            .filter(
                (kind): kind is SellerKnowledgeDomainKind => kind !== undefined,
            ),
    );

    // Câu hỏi trộn tài liệu và dữ liệu live cần nói rõ cả hai mode; không chọn một nguồn rồi làm mất ý còn lại.
    const needsKnowledge = requiredKinds.has('knowledge');
    const needsShopData =
        requiredKinds.has('live-data') || requiredKinds.has('profile');
    if (!needsKnowledge && !needsShopData) return null;

    const modeNames = [
        ...(needsShopData ? ['Dữ liệu shop'] : []),
        ...(needsKnowledge ? ['Tài liệu'] : []),
    ];
    const targetModes =
        modeNames.length === 1
            ? modeNames[0]
            : `${modeNames.slice(0, -1).join(' và ')} và ${modeNames.at(-1)}`;
    return `Mình đang ở chế độ Trò chuyện nên không truy cập dữ liệu shop hoặc tài liệu. Câu hỏi này cần chế độ ${targetModes}; bạn chuyển sang mode phù hợp rồi gửi lại nhé 🙂.`;
}

// Dừng truy vấn live/profile khi người bán đang ở mode Tài liệu và hướng dẫn sang Dữ liệu shop.
// Chỉ quyết định từ request type và registry đã được xác thực; không gọi nguồn live hoặc suy luận quyền từ câu chữ.
export function resolveKnowledgeModeHandoff(
    tasks: SellerQuestionTask[],
    domainKinds: Map<string, SellerKnowledgeDomainKind>,
): string | null {
    const requiresShopData = tasks.some(
        (task) =>
            task.requestType === 'READ_QUERY' &&
            ['live-data', 'profile'].includes(
                domainKinds.get(task.domain ?? '') ?? '',
            ),
    );

    if (!requiresShopData) return null;

    return 'Mình đang ở chế độ Tài liệu nên không truy cập dữ liệu live của shop. Câu hỏi này cần chế độ Dữ liệu shop; bạn chuyển mode đó rồi gửi lại nhé 🙂.';
}
