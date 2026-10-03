import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/infrastructure/registry/load-seller-question-capability-registry';

describe('loadSellerQuestionCapabilityRegistry', () => {
    let temporaryDirectory: string;

    beforeEach(() => {
        // Arrange: tạo thư mục riêng cho cấu hình giả để không chạm vào registry của workspace.
        temporaryDirectory = mkdtempSync(
            join(tmpdir(), 'seller-question-registry-'),
        );
    });

    afterEach(() => {
        // Xóa đúng thư mục tạm do test tạo sau khi hoàn tất từng ca.
        rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    it('should load the default registry from the seller service workspace', () => {
        // Arrange, Act
        const result = loadSellerQuestionCapabilityRegistry();

        // Assert
        expect(result.version).toBe(1);
        expect(result.domains.some(({ code }) => code === 'shipping')).toBe(
            true,
        );
    });

    it('should fail fast when the configured registry path does not exist', () => {
        // Arrange
        const missingPath = join(temporaryDirectory, 'missing.json');

        // Act & Assert
        expect(() => loadSellerQuestionCapabilityRegistry(missingPath)).toThrow(
            'was not found',
        );
    });

    it('should report malformed JSON instead of starting with an empty registry', () => {
        // Arrange
        const invalidPath = join(temporaryDirectory, 'invalid.json');
        writeFileSync(invalidPath, '{invalid', 'utf8');

        // Act & Assert
        expect(() => loadSellerQuestionCapabilityRegistry(invalidPath)).toThrow(
            'invalid JSON',
        );
    });
});
