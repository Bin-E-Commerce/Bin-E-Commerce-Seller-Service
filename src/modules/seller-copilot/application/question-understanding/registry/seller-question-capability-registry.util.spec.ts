import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.util';

describe('validateSellerQuestionCapabilityRegistry', () => {
    const registryPath = resolve(
        process.cwd(),
        'data/seller-knowledge/capability-registry.json',
    );

    it('should accept the configured request types and domains', () => {
        // Arrange
        const registry = JSON.parse(
            readFileSync(registryPath, 'utf8'),
        ) as unknown;

        // Act
        const result = validateSellerQuestionCapabilityRegistry(registry);

        // Assert
        expect(result.version).toBe(1);
        expect(result.requestTypes).toHaveLength(5);
        expect(result.domains.map(({ code }) => code)).toContain('shipping');
    });

    it('should reject a request type that refers to an unregistered domain', () => {
        // Arrange
        const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
            requestTypes: Array<{ code: string; domains: string[] }>;
        };
        registry.requestTypes.find(
            (requestType) => requestType.code === 'READ_QUERY',
        )!.domains = ['missing-domain'];

        // Act & Assert
        expect(() =>
            validateSellerQuestionCapabilityRegistry(registry),
        ).toThrow('unknown domain');
    });

    it('should reject duplicate domain codes', () => {
        // Arrange
        const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
            domains: unknown[];
        };
        registry.domains.push(registry.domains[0]);

        // Act & Assert
        expect(() =>
            validateSellerQuestionCapabilityRegistry(registry),
        ).toThrow('invalid domain');
    });

    it('should allow a new policy domain through registry data without changing planner code', () => {
        // Arrange
        const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
            domains: Array<Record<string, unknown>>;
            requestTypes: Array<{ code: string; domains: string[] }>;
        };
        registry.domains.push({
            code: 'seller-promotions',
            label: 'Khuyến mãi',
            kind: 'knowledge',
            description: 'Tài liệu về chương trình khuyến mãi của shop.',
            documentBacked: true,
        });
        registry.requestTypes
            .find((requestType) => requestType.code === 'READ_QUERY')!
            .domains.push('seller-promotions');

        // Act
        const result = validateSellerQuestionCapabilityRegistry(registry);

        // Assert
        expect(
            result.requestTypes.find(({ code }) => code === 'READ_QUERY')
                ?.domains,
        ).toContain('seller-promotions');
    });
});
