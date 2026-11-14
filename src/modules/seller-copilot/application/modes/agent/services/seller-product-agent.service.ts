// Chuẩn bị preview tồn kho, giá và nội dung từ snapshot thuộc shop; không tự ghi dữ liệu sản phẩm.
// Mọi proposal phải chỉ rõ đối tượng và giá trị đích để bước xác nhận có thể kiểm tra lại trạng thái hiện tại.
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
import {
    messageContainsExactSellerSku,
    messageContainsExactSellerVariant,
} from '@/modules/seller-copilot/application/modes/agent/utils/match-seller-reference.util';
import { normalizeSellerCommandText } from '@/modules/seller-copilot/application/modes/agent/utils/normalize-seller-command-text.util';

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
        const payloads: SellerCopilotActionProposalPayload[] = [];
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
            payloads.push(payload);
        }
        if (!payloads.length) {
            return {
                kind: 'clarification',
                message:
                    'Các mức tồn đề xuất vượt giới hạn lưu trữ hiện tại nên chưa thể tạo preview.',
            };
        }
        const batchId = randomUUID();
        const proposals = await this.saveProposalBatch(
            input,
            batchId,
            payloads,
        );
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
        const linkedProducts = catalog.items.filter(
            (product) => product.isShopLinked,
        );
        const skuOwners = new Map<string, Set<string>>();
        for (const product of linkedProducts) {
            for (const variant of product.variants) {
                for (const sku of [variant.sku, variant.sellerSku].filter(
                    (value): value is string => Boolean(value),
                )) {
                    if (!messageContainsExactSellerSku(input.message, sku)) {
                        continue;
                    }
                    const normalizedSku = normalizeSearchText(sku);
                    const variantIds =
                        skuOwners.get(normalizedSku) ?? new Set<string>();
                    variantIds.add(variant.variantId);
                    skuOwners.set(normalizedSku, variantIds);
                }
            }
        }
        // Một SKU bị gán cho nhiều variant là lỗi catalog; không được biến một định danh mơ hồ thành batch ghi nhiều dòng.
        if ([...skuOwners.values()].some((variantIds) => variantIds.size > 1)) {
            return {
                kind: 'clarification',
                message:
                    'SKU này đang trùng trên nhiều biến thể trong catalog nên mình chưa thể đổi giá an toàn. Hãy kiểm tra lại SKU với shop nhé.',
            };
        }
        const mentionedSkus = linkedProducts.flatMap((product) =>
            product.variants
                .filter((variant) =>
                    [variant.sku, variant.sellerSku]
                        .filter(Boolean)
                        .some((sku) =>
                            messageContainsExactSellerSku(
                                input.message,
                                sku as string,
                            ),
                        ),
                )
                .map((variant) => ({ product, variant })),
        );

        // SKU là định danh rõ ràng; nếu không có SKU thì chỉ nhận đúng một cặp tên sản phẩm/biến thể trong câu.
        const namedCandidates = findNamedVariants(
            linkedProducts,
            input.message,
        );
        if (!mentionedSkus.length && namedCandidates.length > 1) {
            return {
                kind: 'clarification',
                message:
                    'Tên bạn nêu khớp với nhiều biến thể. Bạn gửi SKU hoặc ghi rõ tên sản phẩm kèm tên biến thể cần đổi nhé.',
            };
        }
        const candidates = mentionedSkus.length
            ? mentionedSkus
            : namedCandidates;
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
        const payloads = uniqueCandidates.map(({ product, variant }) => {
            const payload: SellerCopilotActionProposalPayload = {
                kind: 'SET_VARIANT_PRICE',
                productId: product.productId,
                productName: product.name,
                variantId: variant.variantId,
                variantName: variant.name,
                expectedPrice: variant.price,
                nextPrice,
            };
            return payload;
        });
        const proposals = await this.saveProposalBatch(
            input,
            batchId,
            payloads,
        );
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
                    if (
                        candidates.length + skippedVariants.length >
                        MAX_ACTIONS_PER_BATCH
                    ) {
                        return {
                            kind: 'clarification',
                            message: `Có hơn ${MAX_ACTIONS_PER_BATCH} SKU đạt bộ lọc tồn và số bán. Hãy thu hẹp tiêu chí để tạo đề xuất an toàn; chưa có thay đổi nào được tạo.`,
                        };
                    }
                    continue;
                }
                const nextPrice = Math.max(criteria.minimumPrice, reducedPrice);
                candidates.push({
                    ...variant,
                    quantitySold,
                    expectedPrice,
                    nextPrice,
                    effectiveDiscountPercent:
                        ((expectedPrice - nextPrice) / expectedPrice) * 100,
                });
                if (
                    candidates.length + skippedVariants.length >
                    MAX_ACTIONS_PER_BATCH
                ) {
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
        const payloads = eligible.map((candidate) => {
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
            return payload;
        });
        const proposals = await this.saveProposalBatch(
            input,
            batchId,
            payloads,
        );
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

    // Tạo batch tuần tự để biết chính xác những proposal cần dọn nếu một lần lưu giữa chừng thất bại.
    private async saveProposalBatch(
        input: { ownerUserId: string; shopId: string; conversationId: string },
        batchId: string,
        payloads: SellerCopilotActionProposalPayload[],
    ): Promise<SellerCopilotActionProposalRecord[]> {
        const proposals: SellerCopilotActionProposalRecord[] = [];
        try {
            for (const payload of payloads) {
                proposals.push(
                    await this.saveProposal(input, batchId, payload),
                );
            }
            return proposals;
        } catch (error) {
            // Chỉ proposal pending trong đúng owner/shop bị xóa; lỗi dọn không được che lỗi lưu ban đầu.
            if (proposals.length) {
                try {
                    await this.repository.discardPendingActionProposals(
                        {
                            ownerUserId: input.ownerUserId,
                            shopId: input.shopId,
                        },
                        proposals.map((proposal) => proposal.id),
                    );
                } catch {
                    // Proposal còn lại tự hết hạn theo TTL nếu storage không thể dọn ngay.
                }
            }
            throw error;
        }
    }
}

// Gộp tiêu chí trong các tin nhắn theo thứ tự thời gian để câu trả lời sau có thể sửa đúng trường seller vừa được hỏi.
// Kiểm tra đủ ngưỡng tồn, doanh số, kỳ, mức giảm và giá sàn trước mọi truy vấn để không biến dữ liệu thiếu thành 0.
// Dấu phẩy giữa hai mệnh đề là ranh giới hợp lệ; dấu phẩy theo sau bởi chữ số vẫn bị chặn để không cắt nhầm số thập phân.
function parseSlowMovingPriceCriteria(messages: string[]): {
    criteria: SellerSlowMovingPriceCriteria | null;
    message: string;
} {
    const normalizedMessages = messages.map(normalizeSellerCommandText);
    const minimumAvailable = findLastCapturedValue(
        normalizedMessages,
        /(?:ton(?:\s+kho)?|con)\s*(?:it nhat|toi thieu|tu)?\s*(\d+)(?![\d.]|,\d)\s*(?:san pham|sp)?/giu,
    )?.[1];
    const maximumQuantitySold = findLastCapturedValue(
        normalizedMessages,
        /ban\s*(?:toi da|khong qua|nhieu nhat|<=|≤)\s*(\d+)(?![\d.]|,\d)/giu,
    )?.[1];
    // Chấp nhận cả “giảm 10%” và “giảm giá 10%”; nếu không nhận đúng cụm này, câu hỏi hợp lệ sẽ bị hỏi thiếu mức giảm.
    const discountToken = findLastCapturedValue(
        normalizedMessages,
        /giam\s*(?:gia\s*)?(\d+(?:[.,]\d+)?)\s*%/giu,
    )?.[1];
    // “Giá sau giảm không được thấp hơn” biểu đạt cùng một floor với “giá sàn”, nên phải trích đúng số tiền tiếp theo.
    const floorMatch = findLastCapturedValue(
        normalizedMessages,
        /(?:gia\s*san|khong\s*(?:duoc\s*)?(?:thap\s*hon|duoi))\s*(\d[\d.,]*)\s*(dong|d|vnd|nghin|ngan|trieu|tr|k)?(?:\s*(?:dong|d))?(?=$|[\s.!?;,:])/giu,
    );
    const requestedDays = findLastCapturedValue(
        normalizedMessages,
        /(?:trong\s*)?(\d+)\s*ngay/giu,
    )?.[1];
    const periodDays = requestedDays ? Number(requestedDays) : 30;
    const discountPercent = discountToken
        ? Number(discountToken.replace(',', '.'))
        : NaN;
    const minimumPrice = floorMatch?.[1]
        ? parseVietnameseMoney(floorMatch[1], floorMatch[2])
        : null;
    const missing: string[] = [];

    if (minimumAvailable === undefined) missing.push('tồn tối thiểu');
    if (maximumQuantitySold === undefined) missing.push('số bán tối đa');
    if (
        !Number.isFinite(discountPercent) ||
        discountPercent <= 0 ||
        discountPercent >= 100
    ) {
        missing.push('mức giảm lớn hơn 0% và nhỏ hơn 100%');
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
            periodDays:
                periodDays as SellerSlowMovingPriceCriteria['periodDays'],
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

// Đổi tiền VND có dấu phân cách và hậu tố k/nghìn/tr/triệu sang số đồng trước khi áp giá sàn.
function parseVietnameseMoney(value: string, rawSuffix = ''): number | null {
    const token = value.trim();
    const suffix = normalizeSellerCommandText(rawSuffix).replace(/\s+/gu, '');
    const decimalMatch = token.match(/[.,](\d{1,2})$/u);
    const amount = decimalMatch
        ? Number(
              `${token.slice(0, -decimalMatch[0].length).replace(/[.,]/gu, '') || '0'}.${decimalMatch[1]}`,
          )
        : Number(token.replace(/[.,]/gu, ''));
    const multiplier =
        suffix.startsWith('tr') || suffix.startsWith('trieu')
            ? 1_000_000
            : suffix.startsWith('k') ||
                suffix.startsWith('nghin') ||
                suffix.startsWith('ngan')
              ? 1_000
              : 1;
    const price = amount * multiplier;
    return Number.isSafeInteger(price) ? price : null;
}

// Đọc giá VND có phân tách hàng nghìn và cách viết 199k/1,5 triệu; không được hiểu 199k thành 199đ.
function parseRequestedPrice(message: string): number | null {
    const normalizedMessage = normalizeSellerCommandText(message);
    const matches = [
        ...normalizedMessage.matchAll(
            /(?:gia\s+moi|thanh|la|ve|con|len|xuong|sang|=)\s*([\d.,]+)\s*((?:dong|d|vnd|nghin|ngan|trieu|tr|k)(?:\s*(?:dong|d))?)?(?=$|[\s.!?;,:])/giu,
        ),
    ];
    if (!matches.length) return null;

    const prices = matches.map((match) =>
        parsePriceAmount(match[1] ?? '', match[2] ?? ''),
    );
    // Một lần xác nhận chỉ có một giá đích; nhiều giá khác nhau phải được làm rõ trước khi tạo batch proposal.
    if (prices.some((price) => price === null) || new Set(prices).size !== 1) {
        return null;
    }
    return prices[0] ?? null;
}

// Chuyển chuỗi giá cùng đơn vị viết tắt thành đồng; dấu chấm/phẩy cuối 1–2 chữ số là phần thập phân.
function parsePriceAmount(value: string, rawSuffix: string): number | null {
    if (!value) return null;
    const suffix = rawSuffix.replace(/\s+/gu, '');
    const decimalMatch = value.match(/[.,](\d{1,2})$/u);
    const amount = decimalMatch
        ? Number(
              `${value.slice(0, -decimalMatch[0].length).replace(/[.,]/gu, '') || '0'}.${decimalMatch[1]}`,
          )
        : Number(value.replace(/[.,]/gu, ''));
    const multiplier =
        suffix.startsWith('tr') || suffix.startsWith('trieu')
            ? 1_000_000
            : suffix.startsWith('k') ||
                suffix.startsWith('nghin') ||
                suffix.startsWith('ngan')
              ? 1_000
              : 1;
    const price = Math.round(amount * multiplier * 100) / 100;
    return Number.isSafeInteger(Math.round(price * 100)) && price >= 100
        ? price
        : null;
}

// Tên biến thể chỉ hợp lệ khi câu có cả tên product và variant; SKU vẫn là cách chọn ưu tiên cho thao tác ghi.
function findNamedVariants(
    products: SellerCopilotProductCatalogItemInsight[],
    message: string,
) {
    const exactProducts = products.filter((product) =>
        messageContainsExactSellerVariant(message, product.name),
    );
    return exactProducts.flatMap((product) => {
        // Tên sản phẩm đủ để chọn khi catalog chỉ có một biến thể; nhiều biến thể vẫn phải có tên variant rõ ràng.
        const variants =
            product.variants.length === 1
                ? product.variants
                : product.variants.filter((variant) =>
                      messageContainsExactSellerVariant(message, variant.name),
                  );
        return variants.map((variant) => ({ product, variant }));
    });
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

// Tách câu sửa nội dung theo mẫu có dấu/không dấu; nếu thiếu câu trích dẫn thì không đoán phần nào là văn bản mới.
function parseContentChange(message: string): {
    productQuery: string;
    field: 'name' | 'description';
    value: string;
} | null {
    const match = message.match(
        /(tên|ten|mô tả|mo ta)\s+(?:(?:của|cua)\s+)?(.+?)\s+(?:thành|thanh|là|la)\s+["“](.+?)["”]\s*$/iu,
    );
    if (!match?.[2] || !match[3]) return null;
    const field =
        normalizeSellerCommandText(match[1] ?? '') === 'mo ta'
            ? 'description'
            : 'name';
    return {
        productQuery: (match[2] ?? '')
            .replace(/^(?:sản phẩm|san pham)\s+/iu, '')
            .trim(),
        field,
        value: match[3].trim(),
    };
}

// So khớp tên không phân biệt dấu tiếng Việt/hoa thường nhưng giữ chữ số để không nhầm mã sản phẩm.
function normalizeSearchText(value: string): string {
    return normalizeSellerCommandText(value)
        .replace(/["“”'`]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}
