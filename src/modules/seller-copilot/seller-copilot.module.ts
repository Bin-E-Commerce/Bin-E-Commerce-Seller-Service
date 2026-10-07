// Module wiring controller, use case, persistence adapter và các provider AI; không đặt quy tắc phân luồng nghiệp vụ tại đây.
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SellerCopilotConversation } from '@/database/seller-copilot/entities/seller-copilot-conversation.entity';
import { SellerCopilotFeedback } from '@/database/seller-copilot/entities/seller-copilot-feedback.entity';
import { SellerCopilotMessage } from '@/database/seller-copilot/entities/seller-copilot-message.entity';
import { SellerCopilotActionProposal } from '@/database/seller-copilot/entities/seller-copilot-action-proposal.entity';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/conversation/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { ConversationHistoryService } from '@/modules/seller-copilot/application/conversation/history/conversation-history.service';
import { ConversationPersistenceService } from '@/modules/seller-copilot/application/conversation/persistence/conversation-persistence.service';
import { ConversationModeSessionService } from '@/modules/seller-copilot/application/conversation/mode-session/conversation-mode-session.service';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import { TypeOrmSellerCopilotRepository } from '@/modules/seller-copilot/infrastructure/repositories/typeorm-seller-copilot.repository';
import { SellerCopilotController } from '@/modules/seller-copilot/presentation/controllers/seller-copilot.controller';
import { SELLER_QUESTION_PLANNER } from '@/modules/seller-copilot/application/question-understanding/shared/planner/contracts/seller-question-planner.port';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/shared/planner/seller-question-understanding.service';
import { OpenAiSellerQuestionPlannerClient } from '@/modules/seller-copilot/infrastructure/clients/openai-seller-question-planner.client';
import { SellerKnowledgeModule } from '@/modules/seller-knowledge/seller-knowledge.module';
import { SELLER_COPILOT_ANSWER } from '@/modules/seller-copilot/application/answer/shared/ports/seller-copilot-answer.port';
import { OpenAiSellerCopilotAnswerClient } from '@/modules/seller-copilot/infrastructure/clients/openai-seller-copilot-answer.client';
import { SellerDashboardModule } from '@/modules/seller-dashboard/seller-dashboard.module';
import { SellerInventoryAgentClient } from '@/modules/seller-copilot/application/modes/agent/clients/seller-inventory-agent.client';
import { SellerInventoryAgentService } from '@/modules/seller-copilot/application/modes/agent/services/seller-inventory-agent.service';
import { ConfirmSellerInventoryActionUseCase } from '@/modules/seller-copilot/application/modes/agent/actions/confirm-seller-inventory-action.use-case';

// Ghép planner, retrieval knowledge và answer generator; retrieval vẫn chỉ xử lý dữ liệu knowledge đã xuất bản.
@Module({
    // Các module được import cung cấp port/service; TypeORM chỉ cấp entity cho repository adapter của feature này.
    imports: [
        ShopProfileModule,
        SellerDashboardModule,
        SellerKnowledgeModule,
        TypeOrmModule.forFeature([
            SellerCopilotConversation,
            SellerCopilotMessage,
            SellerCopilotFeedback,
            SellerCopilotActionProposal,
        ]),
    ],
    controllers: [SellerCopilotController],
    providers: [
        StreamSellerCopilotUseCase,
        ConfirmSellerInventoryActionUseCase,
        SellerCopilotAccessService,
        ConversationHistoryService,
        ConversationPersistenceService,
        ConversationModeSessionService,
        SellerQuestionUnderstandingService,
        SellerInventoryAgentClient,
        SellerInventoryAgentService,
        OpenAiSellerCopilotAnswerClient,
        {
            provide: SELLER_COPILOT_ANSWER,
            useExisting: OpenAiSellerCopilotAnswerClient,
        },
        {
            provide: SELLER_QUESTION_PLANNER,
            inject: [ConfigService],
            // Factory áp config server-side và giữ một lựa chọn model/timeout thống nhất cho mọi request planner.
            useFactory: (config: ConfigService) =>
                new OpenAiSellerQuestionPlannerClient({
                    apiKey: config.get<string>('OPENAI_API_KEY', ''),
                    model: config.get<string>(
                        'SELLER_COPILOT_MODEL',
                        config.get<string>('OPENAI_MODEL', 'gpt-4.1-mini'),
                    ),
                    timeoutMs: Number(
                        config.get<string>(
                            'SELLER_COPILOT_TIMEOUT_MS',
                            '20000',
                        ),
                    ),
                }),
        },
        {
            provide: SELLER_COPILOT_REPOSITORY,
            // Bind port application vào adapter TypeORM, để use case không phụ thuộc persistence implementation.
            useClass: TypeOrmSellerCopilotRepository,
        },
    ],
})
export class SellerCopilotModule {}
