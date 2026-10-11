// Kết quả context loader đã hợp nhất evidence và snapshot backend; answer generator không tự truy vấn nguồn dữ liệu.
import type { SellerKnowledgeSearchHit } from '@/modules/seller-knowledge/application/ports/seller-knowledge-retrieval.port';
import type { SellerDashboardService } from '@/modules/seller-dashboard/application/services/seller-dashboard.service';
import type { AuthUserClient } from '@/modules/shop-profile/application/clients/auth-user.client';
import type { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import type { SellerCopilotTaskRouting } from '@/modules/seller-copilot/application/answer/shared/utils/route-seller-copilot-tasks.util';
import type { SellerDashboardRange } from '@/modules/seller-dashboard/application/types/seller-dashboard.types';
import type { SellerCopilotProductCatalogSnapshot } from '@/modules/seller-copilot/application/answer/shared/types/seller-copilot-insight.types';

// Giữ nguyên các nguồn đã tải và cờ quyết định để use case chọn abstain hay tiếp tục trả lời.
export interface LoadedSellerCopilotContext {
    contextData: Record<string, unknown>;
    dashboardRange: SellerDashboardRange | null;
    shopSnapshot?: Awaited<ReturnType<SellerDashboardService['getOverview']>>;
    productCatalog?: SellerCopilotProductCatalogSnapshot;
    accountProfile?: Awaited<ReturnType<AuthUserClient['getCopilotProfile']>>;
    evidence: SellerKnowledgeSearchHit[];
    originalQuestionWasRetried: boolean;
    hasContextData: boolean;
    hasContextPayload: boolean;
    hasUnansweredKnowledge: boolean;
    routing: SellerCopilotTaskRouting;
}

// Các kiểu được suy ra từ service nguồn để response giữ nguyên shape hiện có khi adapter thay đổi contract.
export type LoadedSellerCopilotDashboard = Awaited<
    ReturnType<SellerDashboardService['getOverview']>
>;
export type LoadedSellerCopilotProfile = Awaited<
    ReturnType<AuthUserClient['getCopilotProfile']>
>;
export type LoadedSellerCopilotProductCatalog = Awaited<
    ReturnType<SellerInventoryAgentService['getProductCatalog']>
>;
