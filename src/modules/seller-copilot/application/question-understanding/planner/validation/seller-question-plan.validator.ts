// File này xác thực cấu trúc và các ràng buộc nghiệp vụ của plan do AI đề xuất.
// Nó chỉ kiểm tra dữ liệu đầu ra, không quyết định quyền truy cập hay thực thi task.
// Mọi giá trị đi tiếp phải khớp contract và allowlist registry để caller có thể xử lý an toàn.
import type {
    SellerQuestionCapabilityRegistry,
    SellerQuestionRequestTypeDefinition,
} from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import {
    SELLER_CONTEXT_RELATIONS,
    SELLER_QUESTION_REQUEST_TYPES,
    type SellerQuestionPlan,
    type SellerQuestionTask,
} from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';

// Các giới hạn này chặn output quá lớn trước khi plan được lưu hoặc chuyển sang bước sau.
const MAX_TASK_COUNT = 8;
const MAX_RESOLVED_QUESTION_LENGTH = 1000;
const MAX_CLARIFICATION_LENGTH = 500;

// Chỉ các trạng thái phân loại được khai báo ở đây mới được nhận từ model.
const CLASSIFIER_STATUSES = [
    'READY',
    'NEEDS_CLARIFICATION',
    'OUT_OF_SCOPE',
] as const;

// Xác thực toàn bộ plan trước khi trả cho caller; một task sai làm hỏng cả plan.
// Kiểm tra lần lượt hình dạng, giá trị từng trường rồi đến quan hệ nghiệp vụ.
// Nếu model vi phạm contract, trả `null` để caller không dùng một phần kết quả.
export function validateSellerQuestionPlan(
    value: unknown,
    registry: SellerQuestionCapabilityRegistry,
): SellerQuestionPlan | null {
    // Xác nhận kiểu object và tập field trước khi đọc output chưa đáng tin cậy.
    // Chặn field thiếu hoặc thừa để model không âm thầm mở rộng contract.
    if (
        !isRecord(value) ||
        !hasExactKeys(value, [
            'status',
            'contextRelation',
            'tasks',
            'clarificationQuestion',
        ])
    ) {
        return null;
    }

    // Lấy các trường sau khi đã xác nhận object; các giá trị vẫn là unknown và cần kiểm tra riêng.
    const status = value.status;
    const contextRelation = value.contextRelation;
    const rawTasks = value.tasks;
    const clarificationQuestion = value.clarificationQuestion;
    if (
        !CLASSIFIER_STATUSES.includes(
            status as (typeof CLASSIFIER_STATUSES)[number],
        ) ||
        !SELLER_CONTEXT_RELATIONS.includes(
            contextRelation as (typeof SELLER_CONTEXT_RELATIONS)[number],
        ) ||
        !Array.isArray(rawTasks) ||
        rawTasks.length > MAX_TASK_COUNT ||
        (clarificationQuestion !== null &&
            (typeof clarificationQuestion !== 'string' ||
                clarificationQuestion.length > MAX_CLARIFICATION_LENGTH))
    ) {
        return null;
    }

    // Xác thực từng task theo cùng registry để bảo đảm request type-domain hợp lệ.
    // Từ chối toàn bộ plan nếu một task sai, tránh caller xử lý thiếu một phần câu hỏi nhiều ý.
    const tasks: SellerQuestionTask[] = [];
    for (const rawTask of rawTasks) {
        const task = validateTask(rawTask, registry);
        if (!task) return null;
        tasks.push(task);
    }

    // READY phải có yêu cầu trong phạm vi; danh sách rỗng hoặc toàn ngoài phạm vi
    // mâu thuẫn với trạng thái này.
    if (
        status === 'READY' &&
        (tasks.length === 0 ||
            tasks.every((task) => task.requestType === 'OUT_OF_SCOPE'))
    ) {
        return null;
    }

    // OUT_OF_SCOPE chỉ hợp lệ khi có task và tất cả task đều nằm ngoài phạm vi.
    if (
        status === 'OUT_OF_SCOPE' &&
        (tasks.length === 0 ||
            tasks.some((task) => task.requestType !== 'OUT_OF_SCOPE'))
    ) {
        return null;
    }

    // Trạng thái cần làm rõ phải kèm câu hỏi thực sự có nội dung để giao diện hỏi tiếp người dùng.
    if (
        status === 'NEEDS_CLARIFICATION' &&
        (typeof clarificationQuestion !== 'string' ||
            !clarificationQuestion.trim())
    ) {
        return null;
    }

    // Các trạng thái khác không được kèm câu hỏi làm rõ, tránh client hiển thị hai hướng xử lý trái nhau.
    if (status !== 'NEEDS_CLARIFICATION' && clarificationQuestion !== null) {
        return null;
    }

    return {
        status: status as SellerQuestionPlan['status'],
        contextRelation:
            contextRelation as SellerQuestionPlan['contextRelation'],
        tasks,
        clarificationQuestion,
        failureReason: null,
    };
}

// Kiểm tra một task độc lập theo contract và registry cấu hình.
// Request type phải tồn tại, domain phải được loại yêu cầu đó cho phép và câu hỏi diễn giải
// phải có nội dung, nằm trong giới hạn độ dài.
// AI không chọn document ID hay quyền truy cập; backend quyết định ở bước sau.
function validateTask(
    value: unknown,
    registry: SellerQuestionCapabilityRegistry,
): SellerQuestionTask | null {
    // Giới hạn task đúng ba trường được hỗ trợ; từ chối cả thuộc tính lạ để giữ contract kín.
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ['requestType', 'domain', 'resolvedQuestion'])
    ) {
        return null;
    }

    // Đọc giá trị dạng unknown để không mặc định output JSON của model có kiểu đúng.
    const requestType = value.requestType;
    const domain = value.domain;
    const resolvedQuestion = value.resolvedQuestion;

    // Thiếu thông tin được biểu diễn bằng plan NEEDS_CLARIFICATION, không tạo task UNCLEAR.
    // Ở đây chỉ nhận request type đã đăng ký và câu diễn giải có nội dung trong giới hạn.
    if (
        typeof requestType !== 'string' ||
        !SELLER_QUESTION_REQUEST_TYPES.includes(
            requestType as (typeof SELLER_QUESTION_REQUEST_TYPES)[number],
        ) ||
        typeof resolvedQuestion !== 'string' ||
        !resolvedQuestion.trim() ||
        resolvedQuestion.length > MAX_RESOLVED_QUESTION_LENGTH
    ) {
        return null;
    }

    // Registry vừa xác nhận loại yêu cầu, vừa định nghĩa domain nào được phép ghép với loại đó.
    const requestTypeDefinition = registry.requestTypes.find(
        (definition) => definition.code === requestType,
    );

    // Chỉ chấp nhận cặp requestType-domain đã khai báo; model không thể tự mở rộng nguồn dữ liệu.
    if (
        !requestTypeDefinition ||
        !isDomainAllowed(requestTypeDefinition, domain)
    ) {
        return null;
    }

    // Chỉ trả các trường thuộc contract và trim truy vấn để downstream nhận
    // dữ liệu nhất quán.
    return {
        requestType: requestType as SellerQuestionTask['requestType'],
        domain: domain as string | null,
        resolvedQuestion: resolvedQuestion.trim(),
    };
}

// Loại yêu cầu không gắn domain phải nhận `null`; loại có domain chỉ nhận đúng một giá trị trong allowlist.
// Quy tắc này ngăn model gán nhầm task sang nguồn dữ liệu hoặc miền nghiệp vụ khác.
function isDomainAllowed(
    requestType: SellerQuestionRequestTypeDefinition,
    domain: unknown,
): domain is string | null {
    if (requestType.domains.length === 0) return domain === null;
    return typeof domain === 'string' && requestType.domains.includes(domain);
}

// Thu hẹp unknown thành record; array và null không có cấu trúc field của plan
// nên phải bị loại trước khi đọc thuộc tính.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// So sánh cả số lượng lẫn tên field để phát hiện đồng thời field bị thiếu và field ngoài contract.
function hasExactKeys(
    value: Record<string, unknown>,
    expectedKeys: string[],
): boolean {
    return (
        Object.keys(value).length === expectedKeys.length &&
        expectedKeys.every((key) => Object.hasOwn(value, key))
    );
}
