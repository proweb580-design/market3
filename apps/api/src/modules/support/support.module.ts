import { Module } from '@nestjs/common';
import { SupportBotController, SupportFormController, SupportTicketsController, SupportWebhookController } from './support.controller.js';
import { SupportService } from './support.service.js';

@Module({
  controllers: [SupportFormController, SupportTicketsController, SupportBotController, SupportWebhookController],
  providers: [SupportService],
})
export class SupportModule {}
