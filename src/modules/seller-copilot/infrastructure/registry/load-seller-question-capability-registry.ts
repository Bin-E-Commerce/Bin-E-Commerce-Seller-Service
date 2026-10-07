// Nạp registry cấu hình ngoài code; đường dẫn mặc định hoạt động khi chạy từ workspace service hoặc Docker image.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.util';

const DEFAULT_REGISTRY_RELATIVE_PATH =
    'data/seller-knowledge/capability-registry.json';

// Tìm cấu hình rõ ràng trước rồi thử hai working directory phổ biến; lỗi thiếu/sai registry dừng boot thay vì route sai.
export function loadSellerQuestionCapabilityRegistry(
    configuredPath?: string,
): SellerQuestionCapabilityRegistry {
    const candidates = configuredPath
        ? [resolve(configuredPath)]
        : [
              resolve(process.cwd(), DEFAULT_REGISTRY_RELATIVE_PATH),
              resolve(
                  process.cwd(),
                  'services/seller-service',
                  DEFAULT_REGISTRY_RELATIVE_PATH,
              ),
          ];
    const filePath = candidates.find((candidate) => {
        try {
            readFileSync(candidate, 'utf8');
            return true;
        } catch {
            return false;
        }
    });
    if (!filePath) {
        throw new Error(
            `Seller question capability registry was not found. Checked: ${candidates.join(', ')}`,
        );
    }

    const rawConfiguration = readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawConfiguration) as unknown;
    } catch {
        throw new Error(
            `Seller question capability registry is invalid JSON: ${filePath}`,
        );
    }
    return validateSellerQuestionCapabilityRegistry(parsed);
}
