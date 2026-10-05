// Validate registry lúc khởi động và tạo catalog/schema theo cấu hình, không rải domain thành điều kiện trong code.
import type {
    SellerQuestionCapabilityRegistry,
    SellerQuestionRequestTypeDefinition,
} from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import { SELLER_QUESTION_REQUEST_TYPES } from '@/modules/seller-copilot/application/question-understanding/types/seller-question-plan.types';

// Từ chối cấu hình sai ngay khi khởi tạo thay vì để planner âm thầm route vào domain không thể truy xuất.
export function validateSellerQuestionCapabilityRegistry(
    value: unknown,
): SellerQuestionCapabilityRegistry {
    if (!isRecord(value) || value.version !== 1) {
        throw new Error(
            'Seller question capability registry version is invalid.',
        );
    }

    if (!Array.isArray(value.domains) || !Array.isArray(value.requestTypes)) {
        throw new Error('Seller question capability registry is incomplete.');
    }

    const domains = value.domains;
    const requestTypes = value.requestTypes;
    const domainCodes = new Set<string>();
    for (const domain of domains) {
        if (
            !isRecord(domain) ||
            !isNonEmptyString(domain.code) ||
            !isNonEmptyString(domain.label) ||
            !isNonEmptyString(domain.description) ||
            !['knowledge', 'live-data', 'profile'].includes(
                String(domain.kind),
            ) ||
            typeof domain.documentBacked !== 'boolean' ||
            (domain.examples !== undefined &&
                (!Array.isArray(domain.examples) ||
                    domain.examples.some(
                        (example) => !isNonEmptyString(example),
                    ))) ||
            domainCodes.has(domain.code)
        ) {
            throw new Error(
                'Seller question capability registry has an invalid domain.',
            );
        }
        domainCodes.add(domain.code);
    }

    const requestTypeCodes = new Set<string>();
    for (const requestType of requestTypes) {
        if (
            !isRecord(requestType) ||
            !isNonEmptyString(requestType.code) ||
            !isNonEmptyString(requestType.label) ||
            !isNonEmptyString(requestType.description) ||
            !Array.isArray(requestType.domains) ||
            !Array.isArray(requestType.examples) ||
            requestTypeCodes.has(requestType.code) ||
            !SELLER_QUESTION_REQUEST_TYPES.includes(
                requestType.code as (typeof SELLER_QUESTION_REQUEST_TYPES)[number],
            )
        ) {
            throw new Error(
                'Seller question capability registry has an invalid request type.',
            );
        }

        if (
            requestType.domains.some(
                (domainCode) =>
                    typeof domainCode !== 'string' ||
                    !domainCodes.has(domainCode),
            ) ||
            requestType.examples.some((example) => !isNonEmptyString(example))
        ) {
            throw new Error(
                `Seller question request type ${requestType.code} references an unknown domain or example.`,
            );
        }

        requestTypeCodes.add(requestType.code);
    }

    for (const requiredRequestType of SELLER_QUESTION_REQUEST_TYPES) {
        if (!requestTypeCodes.has(requiredRequestType)) {
            throw new Error(
                `Seller question request type ${requiredRequestType} is missing from registry.`,
            );
        }
    }

    return value as unknown as SellerQuestionCapabilityRegistry;
}

// Chỉ đưa mô tả capability/domain và ví dụ ngắn vào prompt; không nhúng nội dung tài liệu hay dữ liệu seller.
export function buildSellerQuestionRegistryCatalog(
    registry: SellerQuestionCapabilityRegistry,
): {
    requestTypes: SellerQuestionRequestTypeDefinition[];
    domains: SellerQuestionCapabilityRegistry['domains'];
} {
    return {
        requestTypes: registry.requestTypes,
        domains: registry.domains,
    };
}

// Kiểm tra cấu trúc object do JSON/config provider đọc được trước khi dùng như registry.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Chuỗi rỗng không được xem là mô tả hợp lệ vì model cần nhãn có nghĩa để phân biệt domain.
function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
