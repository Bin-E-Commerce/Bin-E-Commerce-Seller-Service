// Kiểm tra parse, khớp đối tượng và proposal của agent tồn kho mà không gọi Product Service hoặc database thật.
import type { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';

describe('SellerInventoryAgentService', () => {
    const candidate = {
        productId: 'product-1',
        productName: 'Áo BinGPT 2026',
        variantId: 'variant-1',
        variantName: 'Đỏ / M',
        sku: 'BG-26-RED-M',
        sellerSku: 'SHOP-26-M',
        available: 8,
        reserved: 2,
    };
    let client: { search: jest.Mock };
    let repository: { createActionProposal: jest.Mock };
    let target: SellerInventoryAgentService;

    // Tạo dependency giả cho mỗi case để test đảm bảo agent chỉ tạo proposal, không tự ghi tồn.
    beforeEach(() => {
        client = { search: jest.fn().mockResolvedValue([candidate]) };
        repository = {
            createActionProposal: jest
                .fn()
                .mockImplementation(async (input) => ({
                    id: 'proposal-1',
                    ...input,
                    status: 'pending',
                })),
        };
        target = new SellerInventoryAgentService(
            client as unknown as SellerInventoryAgentClient,
            repository as unknown as SellerCopilotRepositoryPort,
        );
    });

    // Câu đặt số tồn giữ SKU có số trong truy vấn, nhưng chỉ dùng số sau “thành” làm số lượng mới.
    it('creates a set proposal without stripping digits from the SKU', async () => {
        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: '@BinGPT đặt tồn áo BinGPT 2026 SKU BG-26-RED-M thành 15',
        });

        expect(client.search).toHaveBeenCalledWith(
            'shop-1',
            expect.stringContaining('BG-26-RED-M'),
        );
        expect(result).toMatchObject({
            kind: 'proposal',
            payload: {
                expectedAvailable: 8,
                nextAvailable: 15,
            },
        });
        expect(repository.createActionProposal).toHaveBeenCalledTimes(1);
    });

    // Chọn một biến thể rồi nói “lên N” phải giữ SKU, bỏ tồn cũ khỏi query và chỉ đặt đúng target đó.
    it('sets the requested target stock for a selected SKU without searching its old stock value', async () => {
        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@tồn-kho Áo BinGPT 2026 — Đỏ / M (SKU SHOP-26-M, còn 8) lên 20',
        });

        expect(client.search).toHaveBeenCalledWith(
            'shop-1',
            expect.stringContaining('SHOP-26-M'),
        );
        expect(client.search).not.toHaveBeenCalledWith(
            'shop-1',
            expect.stringContaining('8'),
        );
        expect(result).toMatchObject({
            kind: 'proposal',
            payload: {
                productId: 'product-1',
                variantId: 'variant-1',
                expectedAvailable: 8,
                nextAvailable: 20,
            },
        });
        expect(repository.createActionProposal).toHaveBeenCalledTimes(1);
    });

    // “Tăng ... lên N sản phẩm” biểu thị mức tồn cuối cùng, không phải cộng thêm N; hậu tố đơn vị không làm mất lệnh.
    it('parses a target quantity followed by the product unit', async () => {
        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@tồn-kho Áo BinGPT 2026 SKU BG-26-RED-M tăng tồn kho lên 7 sản phẩm',
        });

        expect(result).toMatchObject({
            kind: 'proposal',
            payload: { expectedAvailable: 8, nextAvailable: 7 },
        });
        expect(client.search).toHaveBeenCalledWith(
            'shop-1',
            expect.stringContaining('BG-26-RED-M'),
        );
    });

    // Lệnh dùng đại từ phải tìm bằng SKU của insight và so khớp cả productId/variantId trước khi dựng proposal.
    it('resolves a pronoun to the exact variant supplied by the trusted session insight', async () => {
        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message:
                '@tồn-kho hãy tăng tồn kho của sản phẩm này lên 7 sản phẩm',
            target: {
                productId: 'product-1',
                productName: 'Áo BinGPT 2026',
                variantId: 'variant-1',
                variantName: 'Đỏ / M',
                sku: 'BG-26-RED-M',
                sellerSku: 'SHOP-26-M',
            },
        });

        expect(client.search).toHaveBeenCalledWith('shop-1', 'SHOP-26-M');
        expect(result).toMatchObject({
            kind: 'proposal',
            payload: {
                productId: 'product-1',
                variantId: 'variant-1',
                expectedAvailable: 8,
                nextAvailable: 7,
            },
        });
    });

    // Nếu kết quả tìm bằng SKU không còn đúng ID insight thì không được chuyển sang một biến thể gần giống.
    it('rejects a trusted target that no longer matches the current catalog result', async () => {
        client.search.mockResolvedValue([
            { ...candidate, variantId: 'different-variant' },
        ]);

        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: '@tồn-kho tăng tồn kho của sản phẩm này lên 7 sản phẩm',
            target: {
                productId: 'product-1',
                productName: 'Áo BinGPT 2026',
                variantId: 'variant-1',
                variantName: 'Đỏ / M',
                sku: 'BG-26-RED-M',
                sellerSku: 'SHOP-26-M',
            },
        });

        expect(result.kind).toBe('clarification');
        expect(repository.createActionProposal).not.toHaveBeenCalled();
    });

    // “Tăng thêm” là phép cộng; không cho phép viết nhầm thành con số tuyệt đối.
    it('treats “tăng thêm” as an increment', async () => {
        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: '@BinGPT tăng thêm 5 áo BinGPT 2026 SKU BG-26-RED-M',
        });

        expect(result).toMatchObject({
            kind: 'proposal',
            payload: { expectedAvailable: 8, nextAvailable: 13 },
        });
    });

    // Tên không đủ phân biệt nhiều kết quả phải hỏi seller chọn variant; không lưu proposal mơ hồ.
    it('asks the seller to choose when product variants are ambiguous', async () => {
        client.search.mockResolvedValue([
            candidate,
            { ...candidate, variantId: 'variant-2' },
        ]);

        const result = await target.prepare({
            ownerUserId: 'owner-1',
            shopId: 'shop-1',
            conversationId: 'conversation-1',
            message: '@BinGPT đặt tồn áo BinGPT 2026 thành 15',
        });

        expect(result.kind).toBe('clarification');
        expect(repository.createActionProposal).not.toHaveBeenCalled();
    });
});
