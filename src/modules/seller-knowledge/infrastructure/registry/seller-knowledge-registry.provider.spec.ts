import { SellerKnowledgeRegistryProvider } from '@/modules/seller-knowledge/infrastructure/registry/seller-knowledge-registry.provider';
import type { TypeOrmSellerKnowledgeRepository } from '@/modules/seller-knowledge/infrastructure/repositories/typeorm-seller-knowledge.repository';

// Kiểm tra registry động được cập nhật từ DB mà không restart, còn domain nháp không được đưa vào planner.
describe('SellerKnowledgeRegistryProvider', () => {
    // Dùng registry JSON hiện có và repository giả để test không cần PostgreSQL thật.
    it('exposes only active knowledge domains to the planner', async () => {
        const domains = [
            {
                code: 'seller-returns-guide',
                label: 'Hướng dẫn đổi trả',
                description: 'Quy trình và hướng dẫn đổi trả.',
                examples: ['Đổi trả hàng thế nào?'],
                kind: 'knowledge',
                status: 'ACTIVE',
            },
            {
                code: 'seller-draft-topic',
                label: 'Chủ đề nháp',
                description: 'Chưa được phép phân loại.',
                examples: [],
                kind: 'knowledge',
                status: 'DRAFT',
            },
        ];
        const repository = {
            listDomains: jest.fn().mockResolvedValue(domains),
            findDomain: jest.fn().mockResolvedValue({ code: 'already-seeded' }),
            saveDomain: jest.fn(),
        } as unknown as TypeOrmSellerKnowledgeRepository;
        const config = { get: jest.fn(() => undefined) } as never;
        const provider = new SellerKnowledgeRegistryProvider(
            config,
            repository,
        );
        await provider.onModuleInit();

        const registry = await provider.getActiveRegistry();
        const readQuery = registry.requestTypes.find(
            (item) => item.code === 'READ_QUERY',
        );

        expect(registry.domains.map((domain) => domain.code)).toContain(
            'seller-returns-guide',
        );
        expect(registry.domains.map((domain) => domain.code)).not.toContain(
            'seller-draft-topic',
        );
        expect(readQuery?.domains).toContain('seller-returns-guide');
        expect(readQuery?.domains).not.toContain('seller-draft-topic');
    });
});
