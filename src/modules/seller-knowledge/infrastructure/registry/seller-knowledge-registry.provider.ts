// Ghép capability registry cấu hình với domain knowledge trong PostgreSQL để planner chỉ thấy nhóm đang hoạt động.
// Provider không tạo adapter nghiệp vụ động; domain do admin tạo chỉ được phép mang kind=knowledge.
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
    SellerQuestionCapabilityRegistryProvider,
    SellerQuestionCapabilityRegistry,
} from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { loadSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/infrastructure/registry/load-seller-question-capability-registry';
import { validateSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.util';
import { SellerKnowledgeDomainStatus } from '@/database/seller-knowledge/enums/seller-knowledge-status.enum';
import { SELLER_KNOWLEDGE_SYSTEM_ACTOR_ID } from '@/modules/seller-knowledge/application/constants/seller-knowledge-system.constants';
import { TypeOrmSellerKnowledgeRepository } from '@/modules/seller-knowledge/infrastructure/repositories/typeorm-seller-knowledge.repository';

// Cấp registry tĩnh hiện có cộng domain tài liệu active trong DB; không cho cấu hình admin tạo quyền live/action.
@Injectable()
export class SellerKnowledgeRegistryProvider
    implements SellerQuestionCapabilityRegistryProvider, OnModuleInit
{
    private baseRegistry: SellerQuestionCapabilityRegistry;

    // Config cung cấp registry tĩnh; repository là cổng truy cập domain được seed/quản lý trong DB.
    constructor(
        private readonly config: ConfigService,
        private readonly repository: TypeOrmSellerKnowledgeRepository,
    ) {}

    // Nạp registry tĩnh một lần rồi seed metadata domain hệ thống còn thiếu; dữ liệu đã có không bị ghi đè khi restart.
    // Actor hệ thống được dùng làm dấu nguồn ổn định để API quản trị phân biệt nhóm dựng sẵn với nhóm admin tạo.
    // Nội dung tài liệu vẫn nằm ngoài bảng domain; bước này chỉ bảo đảm danh mục phục vụ định tuyến tồn tại.
    async onModuleInit(): Promise<void> {
        this.baseRegistry = loadSellerQuestionCapabilityRegistry(
            this.config.get<string>('SELLER_COPILOT_CAPABILITY_REGISTRY_PATH'),
        );
        // Seed từng mã còn thiếu để giữ nhãn/trạng thái admin đã chỉnh của các domain hiện hữu.
        for (const domain of this.baseRegistry.domains) {
            if (await this.repository.findDomain(domain.code)) continue;
            await this.repository.saveDomain({
                code: domain.code,
                label: domain.label,
                description: domain.description,
                examples: [],
                kind: domain.kind,
                implementationKey: null,
                status: SellerKnowledgeDomainStatus.ACTIVE,
                createdBy: SELLER_KNOWLEDGE_SYSTEM_ACTOR_ID,
                updatedBy: SELLER_KNOWLEDGE_SYSTEM_ACTOR_ID,
            });
        }
    }

    // Ghép registry tại thời điểm được planner hỏi để đổi trạng thái domain có hiệu lực không cần restart.
    // Domain ACTIVE knowledge được thêm vào loại câu hỏi cho phép tra cứu; live/profile chỉ lấy từ cấu hình backend.
    async getActiveRegistry(): Promise<SellerQuestionCapabilityRegistry> {
        // Dùng cache khởi tạo nếu lifecycle hook đã chạy; fallback giúp provider vẫn hoạt động trong test hoặc bootstrap đặc biệt.
        const base =
            this.baseRegistry ??
            loadSellerQuestionCapabilityRegistry(
                this.config.get<string>(
                    'SELLER_COPILOT_CAPABILITY_REGISTRY_PATH',
                ),
            );
        // Lấy cả ACTIVE/DRAFT/ARCHIVED để so trạng thái mới nhất với registry tĩnh và tìm domain động.
        const persistedDomains = await this.repository.listDomains(true);
        const persistedByCode = new Map(
            persistedDomains.map((domain) => [domain.code, domain]),
        );
        const configuredCodes = new Set(
            base.domains.map((domain) => domain.code),
        );
        // Domain knowledge tĩnh tuân theo trạng thái DB; profile/live giữ nguyên vì adapter đã được backend kiểm soát.
        // Domain hệ thống loại knowledge phải tuân DB; domain live/profile không bị DB knowledge vô tình tắt.
        const activeBaseDomains = base.domains.filter(
            (domain) =>
                domain.kind !== 'knowledge' ||
                persistedByCode.get(domain.code)?.status === 'ACTIVE',
        );
        // Chỉ thêm domain active do admin tạo nếu nó không trùng mã tĩnh; kind bị chốt knowledge để không mở action adapter.
        const dynamicDomains = persistedDomains
            .filter(
                (domain) =>
                    domain.status === 'ACTIVE' &&
                    domain.kind === 'knowledge' &&
                    !configuredCodes.has(domain.code),
            )
            .map((domain) => ({
                code: domain.code,
                label: domain.label,
                kind: 'knowledge' as const,
                description: domain.description,
                examples: domain.examples,
                documentBacked: true,
            }));
        const domains = [...activeBaseDomains, ...dynamicDomains];
        const activeCodes = new Set(domains.map((domain) => domain.code));
        const dynamicCodes = dynamicDomains.map((domain) => domain.code);
        // Chỉ READ_QUERY/CAPABILITY_QUERY nhận dynamic domain vì chúng có retrieval tài liệu; loại request khác giữ allowlist.
        const requestTypes = base.requestTypes.map((type) => ({
            ...type,
            domains:
                type.code === 'READ_QUERY' || type.code === 'CAPABILITY_QUERY'
                    ? [
                          ...new Set([
                              ...type.domains.filter((code) =>
                                  activeCodes.has(code),
                              ),
                              ...dynamicCodes,
                          ]),
                      ]
                    : type.domains.filter((code) => activeCodes.has(code)),
        }));
        // Validate registry ghép hoàn chỉnh để bảo vệ invariant giữa requestTypes và domains trước khi planner sử dụng.
        return validateSellerQuestionCapabilityRegistry({
            ...base,
            domains,
            requestTypes,
        });
    }
}
