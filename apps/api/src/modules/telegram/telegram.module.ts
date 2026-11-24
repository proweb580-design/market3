import { Global, Module } from '@nestjs/common';
import { BOT_API, HttpBotApi } from './bot-api.js';
import { PlatformTokenService } from './platform-token.service.js';
import { TelegramAccountController, TelegramController, TelegramIntegrationController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

@Global()
@Module({
  controllers: [TelegramController, TelegramAccountController, TelegramIntegrationController],
  providers: [TelegramService, PlatformTokenService, { provide: BOT_API, useClass: HttpBotApi }],
  exports: [PlatformTokenService, TelegramService, BOT_API],
})
export class TelegramModule {}
