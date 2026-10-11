// Điều phối đề xuất giá và nội dung sản phẩm; không ghi Product Service trực tiếp.
// Mọi mutation được lưu thành proposal gắn owner/shop/conversation rồi chờ xác nhận ở use case riêng.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import type { SellerCopilotRepositoryPort } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import { SellerOrderSalesClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-order-sales.client';
import type {
    SellerCopilotActionProposalPayload,
    SellerCopilotActionProposalRecord,
} from '@/modules/seller-copilot/application/modes/agent/types/seller-copilot-action.types';
import type { SellerCopilotProductCatalogItemInsight } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';
import type {
    SellerSlowMovingPriceCandidate,
    SellerSlowMovingPriceCriteria,
} from '@/modules/seller-copilot/application/modes/agent/types/seller-slow-moving-price.types';

const ACTION_PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIONS_PER_BATCH = 50;

// Tác vụ sản phẩm dùng catalog xác thực, luật định sẵn và proposal riêng theo dòng để cho phép xác nhận độc lập.
@Injectable()
export class SellerProductAgentService {
    constructor(
        private readonly inventoryClient: SellerInventoryAgentClient,
        private readonly orderSalesClient: SellerOrderSalesClient,
        @Inject(SELLER_COPILOT_REPOSITORY)
        private readonly repository: SellerCopilotRepositoryPort,
    ) {}

    // Lấy danh sách low-stock từ truy vấn phân trang và dựng target 2×ngưỡng; giới hạn batch tránh tạo hàng nghìn proposal một lượt.
    async prepareLowStock(input: {
        ownerUserId: string;
        shopId: string;
        conversationId: string;
    }): Promise<
        | { kind: 'clarification'; message: string }
        | {
              kind: 'proposals';
              batchId: string;
              proposals: SellerCopilotActionProposalRecord[];
              skippedCount: number;
          }
    > {
        const variants = await this.inventoryClient.getLowStockVariants(
            input.shopId,
            input.ownerUserId,
        );
        if (!variants.length) {
            return {
                kind: 'clarification',
                message:
                    'Mình đã rà toàn bộ shop và chưa tìm thấy biến thể nào ở mức tồn thấp.',
            };
        }
        if (variants.length > MAX_ACTIONS_PER_BATCH) {
            return {
                kind: 'clarification',
                message: `Có ${variants.length} biến thể cần xử lý. Để tránh tạo danh sách quá lớn, hãy lọc hoặc xử lý tối đa ${MAX_ACTIONS_PER_BATCH} biến thể mỗi lượt.`,
            };
        }
        const batchId = randomUUID();
        const proposals: SellerCopilotActionProposalRecord[] = [];
        for (const variant of variants) {
            const nextAvailable = variant.lowStockThreshold * 2;
            if (
                !Number.isSafeInteger(nextAvailable) ||
                nextAvailable + variant.reserved > 2_147_483_647
            ) {
                continue;
            }
            const payload = {
                kind: 'SET_INVENTORY' as const,
                productId: variant.productId,
                productName: variant.productName,
                variantId: variant.variantId,
                variantName: variant.variantName,
                expectedAvailable: variant.available,
                nextAvailable,
                lowStockThreshold: variant.lowStockThreshold,
                reserved: variant.reserved,
                recommendationReason: 'LOW_STOCK' as const,
            };
            proposals.push(await this.saveProposal(input, batchId, payload));
        }
        if (!proposals.length) {
            return {
                kind: 'clarification',
                message:
                    'Các mức tồn đề xuất vượt giới hạn lưu trữ hiện tại nên chưa thể tạo preview.',
            };
        }
        return {
            kind: 'proposals',
            batchId,
            proposals,
            skippedCount: variants.length - proposals.length,
        };
    }

    // Tạo đề xuất giá cố định cho các biến thể có SKU được nêu rõ trong câu; tên mơ hồ không được mở rộng thành cả sản phẩm.
    async preparePriceChange(input: {
        ownerUserId: string;
        shopId: string;
        conversationId: string;
        message: string;
    }): Promise<
        | { kind: 'clarification'; message: string }
        | {
              kind: 'proposals';
              batchId: string;
              proposals: SellerCopilotActionProposalRecord[];
          }
    > {
        const nextPrice = parseRequestedPrice(input.message);
        if (nextPrice === null) {
            return {
                kind: 'clarification',
                message:
                    'Bạn gửi mức giá mới và SKU biến thể muốn đổi nhé. Ví dụ: `@giá đổi SKU BG-26-M thành 199.000đ`.',
            };
        }

        const catalog = await this.inventoryClient.getProductCatalog(
            input.shopId,
            input.ownerUserId,
        );
        const mentionedSkus = catalog.items
            .filter((product) => product.isShopLinked)
            .flatMap((product) =>
                product.variants
                    .filter((variant) =>
                        [variant.sku, variant.sellerSku]
                            .filter(Boolean)
                            .some((sku) =>
                                input.message
                                    .toLocaleLowerCase('vi')
                                    .includes(
                                        (sku as string).toLocaleLowerCase('vi'),
                                    ),
                            ),
                    )
                    .map((variant) => ({ product, variant })),
            );

        // SKU là định danh rõ ràng; nếu không có SKU thì chỉ nhận đúng một cặp tên sản phẩm/biến thể trong câu.
        const candidates = mentionedSkus.length
            ? mentionedSkus
            : findNamedVariants(
                  catalog.items.filter((product) => product.isShopLinked),
                  input.message,
              );
        const uniqueCandidates = [
            ...new Map(
                candidates.map((candidate) => [
                    candidate.variant.variantId,
                    candidate,
                ]),
            ).values(),
        ];
        if (
            !uniqueCandidates.length ||
            uniqueCandidates.length > MAX_ACTIONS_PER_BATCH
        ) {
            return {
                kind: 'clarification',
                message: uniqueCandidates.length
                    ? `Mình tìm thấy hơn ${MAX_ACTIONS_PER_BATCH} biến thể phù hợp. Hãy chia nhỏ danh sách SKU để xem trước an toàn nhé.`
                    : 'Mình chưa xác định được SKU/biến thể duy nhất. Bạn gửi SKU cần đổi giá nhé.',
            };
        }

        const batchId = randomUUID();
        const proposals: SellerCopilotActionProposalRecord[] = [];
        for (const { product, variant } of uniqueCandidates) {
            const payload: SellerCopilotActionProposalPayload = {
                kind: 'SET_VARIANT_PRICE',
                productId: product.productId,
                productName: product.name,
                variantId: variant.variantId,
                variantName: variant.name,
                expectedPrice: variant.price,
                nextPrice,
            };
            proposals.push(await this.saveProposal(input, batchId, payload));
        }
        return { kind: 'proposals', batchId, proposals };
    }

    // Quét variant theo trang, đối chiếu số bán hoàn tất theo kỳ rồi mới lưu proposal để không tạo batch thiếu dữ liệu.
    // Tiêu chí thiếu/sai được hỏi lại; lỗi một nguồn dừng toàn bộ luồng thay vì hiểu dữ liệu không tải được là 0.
    // Giá giảm bị chặn ở floor do seller nhập, còn price service vẫn kiểm tra floor và expectedPrice khi xác nhận.
    async prepareSlowMovingPriceChange(input: {
        ownerUserId: string;
        shopId: string;
        conversationId: string;
        message: string;
        contextMessages?: string[];
    }): Promise<
        | { kind: 'clarification'; message: string }
        | {
              kind: 'proposals';
              batchId: string;
              proposals: SellerCopilotActionProposalRecord[];
              skippedVariants: Array<{ name: string; reason: string }>;
          }
    > {
        const parsed = parseSlowMovingPriceCriteria([
            ...(input.contextMessages ?? []),
            input.message,
        ]);
        if (!parsed.criteria) {
            return { kind: 'clarification', message: parsed.message };
        }

        const criteria = parsed.criteria;
        const to = new Date();
        const from = new Date(
            to.getTime() - criteria.periodDays * 24 * 60 * 60 * 1000,
        );
        const candidates: SellerSlowMovingPriceCandidate[] = [];
        const skippedVariants: Array<{ name: string; reason: string }> = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const page = await this.inventoryClient.getActiveVariantPage({
                shopId: input.shopId,
                ownerUserId: input.ownerUserId,
                offset,
                limit: 100,
            });
            if (page.items.length === 0 && page.hasMore) {
                return {
                    kind: 'clarification',
                    message:
                        'Product Service trả danh sách biến thể chưa đầy đủ. Mình chưa tạo đề xuất để tránh bỏ sót SKU.',
                };
            }
            const sales = await this.orderSalesClient.getVariantSales({
                shopId: input.shopId,
                variantIds: page.items.map((variant) => variant.variantId),
                from,
                to,
            });

            for (const variant of page.items) {
                const quantitySold = sales.get(variant.variantId) ?? 0;
                if (
                    variant.available <= 0 ||
                    variant.available < criteria.minimumAvailable ||
                    quantitySold > criteria.maximumQuantitySold
                ) {
                    continue;
                }
                const expectedPrice = Number(variant.price);
                const reducedPrice = Math.round(
                    expectedPrice * (1 - criteria.discountPercent / 100),
                );
                if (
                    !Number.isFinite(expectedPrice) ||
                    expectedPrice < 100 ||
                    expectedPrice <= criteria.minimumPrice
                ) {
                    skippedVariants.push({
                        name: `${variant.productName} — ${variant.variantName}`,
                        reason: 'Giá hiện tại không cao hơn giá sàn nên không thể giảm.',
                    });
                    if (candidates.length + skippedVariants.length > MAX_ACTIONS_PER_BATCH) {
                        return {
                            kind: 'clarification',
                            message: `Có hơn ${MAX_ACTIONS_PER_BATCH} SKU đạt bộ lọc tồn và số bán. Hãy thu hẹp tiêu chí để tạo đề xuất an toàn; chưa có thay đổi nào được tạo.`,
                        };
                    }
                    continue;
                }
                const nextPrice = Math.max(
                    criteria.minimumPrice,
                    reducedPrice,
                );
                candidates.push({
                    ...variant,
                    quantitySold,
                    expectedPrice,
                    nextPrice,
                    effectiveDiscountPercent:
                        ((expectedPrice - nextPrice) / expectedPrice) * 100,
                });
                if (candidates.length + skippedVariants.length > MAX_ACTIONS_PER_BATCH) {
                    return {
                        kind: 'clarification',
                        message: `Có hơn ${MAX_ACTIONS_PER_BATCH} SKU thỏa tiêu chí. Hãy tăng ngưỡng tồn hoặc giảm số bán tối đa để thu hẹp danh sách; chưa có thay đổi nào được tạo.`,
                    };
                }
            }

            offset += page.items.length;
            hasMore = page.hasMore;
        }

        if (!candidates.length && !skippedVariants.length) {
            return {
                kind: 'clarification',
                message:
                    'Không tìm thấy SKU nào thỏa ngưỡng tồn và số bán trong kỳ bạn chọn.',
            };
        }

        const eligible = candidates.filter((candidate) => {
            if (candidate.nextPrice >= candidate.expectedPrice) {
                skippedVariants.push({
                    name: `${candidate.productName} — ${candidate.variantName}`,
                    reason: 'Giá hiện tại không cao hơn giá sàn nên không thể giảm.',
                });
                return false;
            }
            return true;
        });
        if (!eligible.length) {
            // Khi tất cả SKU đạt bộ lọc nhưng giá đã chạm floor, nêu cụ thể SKU bị bỏ qua thay vì báo nhầm là không có candidate.
            const skippedSummary = skippedVariants
                .slice(0, 10)
                .map(({ name, reason }) => `${name}: ${reason}`)
                .join(' · ');
            const additionalSkippedCount = Math.max(
                0,
                skippedVariants.length - 10,
            );
            return {
                kind: 'clarification',
                message: `Có ${skippedVariants.length} SKU đạt bộ lọc tồn và số bán nhưng giá hiện tại không cao hơn giá sàn ${criteria.minimumPrice.toLocaleString('vi-VN')}đ, nên chưa thể tạo đề xuất giảm. ${skippedSummary}${additionalSkippedCount ? ` · Còn ${additionalSkippedCount} SKU khác cùng lý do.` : ''}`,
            };
        }

        const batchId = randomUUID();
        const proposals: SellerCopilotActionProposalRecord[] = [];
        for (const candidate of eligible) {
            const payload: SellerCopilotActionProposalPayload = {
                kind: 'SET_VARIANT_PRICE',
                productId: candidate.productId,
                productName: candidate.productName,
                variantId: candidate.variantId,
                variantName: candidate.variantName,
                expectedPrice: candidate.expectedPrice,
                nextPrice: candidate.nextPrice,
                minimumPrice: criteria.minimumPrice,
                priceRecommendation: {
                    kind: 'SLOW_MOVING_CLEARANCE',
                    available: candidate.available,
                    quantitySold: candidate.quantitySold,
                    periodDays: criteria.periodDays,
                    requestedDiscountPercent: criteria.discountPercent,
                    effectiveDiscountPercent:
                        candidate.effectiveDiscountPercent,
                },
            };
            proposals.push(await this.saveProposal(input, batchId, payload));
        }
        return { kind: 'proposals', batchId, proposals, skippedVariants };
    }

    // Chỉ tạo đề xuất nội dung khi người bán cung cấp văn bản mới; Agent không tự bịa đặc tính chưa có trong catalog.
    async prepareContentChange(input: {
        ownerUserId: string;
        shopId: string;
        conversationId: string;
        message: string;
    }): Promise<
        | { kind: 'clarification'; message: string }
        | {
              kind: 'proposal';
              batchId: string;
              proposal: SellerCopilotActionProposalRecord;
          }
    > {
        const content = parseContentChange(input.message);
        if (!content) {
            return {
                kind: 'clarification',
                message:
                    'Bạn ghi rõ SKU/tên sản phẩm và nội dung mới muốn dùng nhé. Mình không tự tạo thông tin sản phẩm chưa được shop cung cấp.',
            };
        }
        const catalog = await this.inventoryClient.getProductCatalog(
            input.shopId,
            input.ownerUserId,
        );
        const product = findUniqueProduct(
            catalog.items.filter((item) => item.isShopLinked),
            content.productQuery,
        );
        if (!product) {
            return {
                kind: 'clarification',
                message:
                    'Mình chưa xác định được duy nhất sản phẩm cần sửa. Bạn gửi SKU hoặc tên đầy đủ nhé.',
            };
        }

        const nextName = content.field === 'name' ? content.value : undefined;
        const nextDescription =
            content.field === 'description' ? content.value : undefined;
        const payload: SellerCopilotActionProposalPayload = {
            kind: 'UPDATE_PRODUCT_CONTENT',
            productId: product.productId,
            productName: product.name,
            ...(nextName !== undefined
                ? { expectedName: product.name, nextName }
                : {}),
            ...(nextDescription !== undefined
                ? {
                      expectedDescription: product.fullDescription ?? null,
                      nextDescription,
                  }
                : {}),
        };
        const batchId = randomUUID();
        const proposal = await this.saveProposal(input, batchId, payload);
        return { kind: 'proposal', batchId, proposal };
    }

    // Lưu proposal kèm tenant và batch trước khi phát sự kiện preview; không gọi API mutation tại bước này.
    private saveProposal(
        input: { ownerUserId: string; shopId: string; conversationId: string },
        batchId: string,
        payload: SellerCopilotActionProposalPayload,
    ): Promise<SellerCopilotActionProposalRecord> {
        return this.repository.createActionProposal({
            ...input,
            batchId,
            payload,
            expiresAt: new Date(Date.now() + ACTION_PROPOSAL_TTL_MS),
        });
    }
}

// Đọc đủ năm tham số trước khi truy vấn; kỳ mặc định 30 ngày nhưng các ngưỡng nghiệp vụ luôn do seller chỉ định.
function parseSlowMovingPriceCriteria(messages: string[]): {
    criteria: SellerSlowMovingPriceCriteria | null;
    message: string;
} {
    const normalizedMessages = messages.map((message) =>
        message.normalize('NFC'),
    );
    const minimumAvailable = findLastCapturedValue(
        normalizedMessages,
        /(?:tồn(?:\s+kho)?|còn)\s*(?:ít nhất|tối thiểu|từ)?\s*(\d+)\s*(?:sản phẩm|sp)?/giu,
    )?.[1];
    const maximumQuantitySold = findLastCapturedValue(
        normalizedMessages,
        /bán\s*(?:tối đa|không quá|nhiều nhất|<=|≤)\s*(\d+)/giu,
    )?.[1];
    // Chấp nhận cả “giảm 10%” và “giảm giá 10%”; nếu không nhận đúng cụm này, câu hỏi hợp lệ sẽ bị hỏi thiếu mức giảm.
    const discountToken = findLastCapturedValue(
        normalizedMessages,
        /giảm\s*(?:giá\s*)?(\d+(?:[.,]\d+)?)\s*%/giu,
    )?.[1];
    // “Giá sau giảm không được thấp hơn” biểu đạt cùng một floor với “giá sàn”, nên phải trích đúng số tiền tiếp theo.
    const floorToken = findLastCapturedValue(
        normalizedMessages,
        /(?:giá\s*sàn|không\s*(?:được\s*)?(?:thấp\s*hơn|dưới))\s*(\d[\d.,]*)\s*(?:đ|vnd)?/giu,
    )?.[1];
    const requestedDays = findLastCapturedValue(
        normalizedMessages,
        /(?:trong\s*)?(\d+)\s*ngày/giu,
    )?.[1];
    const periodDays = requestedDays ? Number(requestedDays) : 30;
    const discountPercent = discountToken ? Number(discountToken.replace(',', '.')) : NaN;
    const minimumPrice = floorToken
        ? parseVietnameseMoney(floorToken)
        : null;
    const missing: string[] = [];

    if (minimumAvailable === undefined) missing.push('tồn tối thiểu');
    if (maximumQuantitySold === undefined) missing.push('số bán tối đa');
    if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
        missing.push('mức giảm lớn hơn 0%');
    }
    if (
        minimumPrice === null ||
        minimumPrice < 100 ||
        minimumPrice > 2_147_483_647
    ) {
        missing.push('giá sàn từ 100đ đến giới hạn giá hệ thống');
    }
    if (![7, 30, 90].includes(periodDays)) {
        return {
            criteria: null,
            message:
                'Kỳ thống kê chỉ hỗ trợ 7, 30 hoặc 90 ngày. Bạn chọn một kỳ này giúp mình nhé.',
        };
    }
    if (
        minimumAvailable !== undefined &&
        (!Number.isSafeInteger(Number(minimumAvailable)) ||
            Number(minimumAvailable) < 1)
    ) {
        missing.push('tồn tối thiểu là số nguyên lớn hơn 0');
    }
    if (
        maximumQuantitySold !== undefined &&
        (!Number.isSafeInteger(Number(maximumQuantitySold)) ||
            Number(maximumQuantitySold) < 0)
    ) {
        missing.push('số bán tối đa là số nguyên không âm');
    }
    if (missing.length) {
        return {
            criteria: null,
            message: `Để lọc và đề xuất an toàn, bạn cho mình biết ${missing.join(', ')} nhé. Ví dụ: “Tồn ít nhất 10, bán tối đa 2 trong 30 ngày, giảm 10%, giá sàn 150.000đ.”`,
        };
    }

    return {
        criteria: {
            minimumAvailable: Number(minimumAvailable),
            maximumQuantitySold: Number(maximumQuantitySold),
            periodDays: periodDays as SellerSlowMovingPriceCriteria['periodDays'],
            discountPercent,
            minimumPrice: minimumPrice as number,
        },
        message: '',
    };
}

// Lấy giá trị xuất hiện sau cùng để phần seller vừa trả lời ghi đè đúng trường cũ mà vẫn giữ tiêu chí còn lại.
function findLastCapturedValue(
    messages: string[],
    pattern: RegExp,
): RegExpMatchArray | undefined {
    let lastMatch: RegExpMatchArray | undefined;
    for (const message of messages) {
        // Regex global trả mọi lần xuất hiện trong lượt; chỉ nhận capture cuối, không để kỳ cũ thắng kỳ mới.
        for (const match of message.matchAll(pattern)) {
            lastMatch = match;
        }
    }
    return lastMatch;
}

// Chuẩn hóa giá VND có dấu chấm/phẩy phân tách hàng nghìn; mức floor chỉ nhận số nguyên để tránh làm tròn xuống ngoài ý muốn.
function parseVietnameseMoney(value: string): number | null {
    const normalized = value.replace(/[.,]/gu, '');
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) ? amount : null;
}

// Đọc giá VND kiểu 199.000đ như 199000, đồng thời giữ được phần thập phân nếu người bán nhập rõ.
function parseRequestedPrice(message: string): number | null {
    const match = message.match(/(?:thành|là|về|=)\s*([\d.,]+)\s*(?:đ|vnd)?/iu);
    if (!match?.[1]) return null;
    const token = match[1];
    const normalized = /[.,]\d{1,2}$/u.test(token)
        ? token.replace(',', '.')
        : token.replace(/[.,]/gu, '');
    const price = Number(normalized);
    return Number.isFinite(price) && price >= 100 ? price : null;
}

// Tên biến thể chỉ hợp lệ khi câu có cả tên product và variant; SKU vẫn là cách chọn ưu tiên cho thao tác ghi.
function findNamedVariants(
    products: SellerCopilotProductCatalogItemInsight[],
    message: string,
) {
    const normalized = normalizeSearchText(message);
    return products.flatMap((product) =>
        product.variants
            .filter(
                (variant) =>
                    normalizeSearchText(product.name).length > 0 &&
                    normalizeSearchText(variant.name).length > 0 &&
                    normalized.includes(normalizeSearchText(product.name)) &&
                    normalized.includes(normalizeSearchText(variant.name)),
            )
            .map((variant) => ({ product, variant })),
    );
}

// Chỉ match một product theo UUID, SKU, seller SKU hoặc tên đầy đủ; match nhiều dòng phải hỏi seller chọn.
function findUniqueProduct(
    products: SellerCopilotProductCatalogItemInsight[],
    query: string,
): SellerCopilotProductCatalogItemInsight | null {
    const normalized = normalizeSearchText(query);
    const matches = products.filter(
        (product) =>
            product.productId.toLocaleLowerCase('vi') === normalized ||
            normalizeSearchText(product.name) === normalized ||
            product.variants.some(
                (variant) =>
                    normalizeSearchText(variant.sku) === normalized ||
                    normalizeSearchText(variant.sellerSku ?? '') === normalized,
            ),
    );
    return matches.length === 1 ? (matches[0] ?? null) : null;
}

// Tách câu sửa nội dung theo mẫu tường minh; nếu thiếu dấu phân cách thì không đoán phần nào là văn bản mới.
function parseContentChange(message: string): {
    productQuery: string;
    field: 'name' | 'description';
    value: string;
} | null {
    const match = message.match(
        /(?:tên|mô tả)\s+(?:của\s+)?(.+?)\s+(?:thành|là)\s+["“](.+?)["”]\s*$/iu,
    );
    if (!match?.[1] || !match[2]) return null;
    const field = /mô tả/iu.test(message.slice(0, message.indexOf(match[1])))
        ? 'description'
        : 'name';
    return {
        productQuery: match[1].replace(/^sản phẩm\s+/iu, '').trim(),
        field,
        value: match[2].trim(),
    };
}

// So khớp tên không phân biệt hoa thường/dấu câu nhưng không xóa chữ số để tránh nhầm SKU và mã sản phẩm.
function normalizeSearchText(value: string): string {
    return value
        .normalize('NFC')
        .toLocaleLowerCase('vi')
        .replace(/["“”'`]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}
