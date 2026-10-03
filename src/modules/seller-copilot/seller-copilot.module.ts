import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SellerCopilotConversation } from '@/database/seller-copilot/entities/seller-copilot-conversation.entity';
import { SellerCopilotFeedback } from '@/database/seller-copilot/entities/seller-copilot-feedback.entity';
import { SellerCopilotMessage } from '@/database/seller-copilot/entities/seller-copilot-message.entity';
import { ShopProfileModule } from '@/modules/shop-profile/shop-profile.module';
import { SELLER_COPILOT_REPOSITORY } from '@/modules/seller-copilot/application/shared/ports/seller-copilot-repository.port';
import { SellerCopilotAccessService } from '@/modules/seller-copilot/application/conversation/access/seller-copilot-access.service';
import { ConversationHistoryService } from '@/modules/seller-copilot/application/conversation/history/conversation-history.service';
import { ConversationPersistenceService } from '@/modules/seller-copilot/application/conversation/persistence/conversation-persistence.service';
import { StreamSellerCopilotUseCase } from '@/modules/seller-copilot/application/conversation/streaming/stream-seller-copilot.use-case';
import { TypeOrmSellerCopilotRepository } from '@/modules/seller-copilot/infrastructure/repositories/typeorm-seller-copilot.repository';
import { SellerCopilotController } from '@/modules/seller-copilot/presentation/controllers/seller-copilot.controller';
import { SELLER_QUESTION_CAPABILITY_REGISTRY } from '@/modules/seller-copilot/application/question-understanding/registry/seller-question-capability-registry.types';
import { SELLER_QUESTION_PLANNER } from '@/modules/seller-copilot/application/question-understanding/planner/contracts/seller-question-planner.port';
import { SellerQuestionUnderstandingService } from '@/modules/seller-copilot/application/question-understanding/planner/classification/seller-question-understanding.service';
import { OpenAiSellerQuestionPlannerClient } from '@/modules/seller-copilot/infrastructure/clients/openai-seller-question-planner.client';
import { loadSellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/infrastructure/registry/load-seller-question-capability-registry';

// Đăng ký planner nội bộ độc lập; stream công khai vẫn giữ thông báo bảo trì cho tới phase sinh câu trả lời.
@Module({
    imports: [
        ShopProfileModule,
        TypeOrmModule.forFeature([
            SellerCopilotConversation,
            SellerCopilotMessage,
            SellerCopilotFeedback,
        ]),
    ],
    controllers: [SellerCopilotController],
    providers: [
        StreamSellerCopilotUseCase,
        SellerCopilotAccessService,
        ConversationHistoryService,
        ConversationPersistenceService,
        SellerQuestionUnderstandingService,
        {
            provide: SELLER_QUESTION_CAPABILITY_REGISTRY,
            inject: [ConfigService],
            useFactory: (config: ConfigService) =>
                loadSellerQuestionCapabilityRegistry(
                    config.get<string>(
                        'SELLER_COPILOT_CAPABILITY_REGISTRY_PATH',
                    ),
                ),
        },
        {
            provide: SELLER_QUESTION_PLANNER,
            inject: [ConfigService],
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
            useClass: TypeOrmSellerCopilotRepository,
        },
    ],
})
export class SellerCopilotModule {}
