import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { connectBotSchema, supportMessageSchema, type SupportMessage, telegramAuthSchema, telegramRefreshSchema } from '@repo/shared';
import { z } from 'zod';
import { CurrentPrincipal, CurrentTenant, Public, Req, RequirePermissions, UserOnly } from '../../common/decorators.js';
import type { AppRequest, Principal, Tenant } from '../../common/principal.js';
import { ApiZodBody, ZodPipe } from '../../common/zod.js';
import { RequireFeature } from '../billing/subscription.guard.js';
import { TelegramService } from './telegram.service.js';

const userId = (p: Principal) => (p as { user: { id: string } }).user.id;

@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  /** Mini App sign-in: exchanges signed initData for a session. The Telegram user comes only from verified initData. */
  @Post('auth')
  @Public()
  @ApiZodBody(telegramAuthSchema)
  auth(@Req() req: AppRequest, @Body(new ZodPipe(telegramAuthSchema)) body: z.infer<typeof telegramAuthSchema>) {
    return this.telegram.authenticate(req, body.initData, body.store);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  @ApiZodBody(telegramRefreshSchema)
  refresh(@Body(new ZodPipe(telegramRefreshSchema)) body: z.infer<typeof telegramRefreshSchema>) {
    return this.telegram.refresh(body.refreshToken);
  }

  /** Web user → one-time deep-link parameter (t.me/<bot>?startapp=…) that links their Telegram account. */
  @Post('link-code')
  @ApiBearerAuth()
  @UserOnly()
  linkCode(@Req() req: AppRequest, @CurrentPrincipal() p: Principal) {
    return this.telegram.createLinkCode(req, userId(p));
  }

  @Post('webhook/:integrationId')
  @HttpCode(200)
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  webhook(@Param('integrationId', ParseUUIDPipe) id: string, @Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: unknown) {
    return this.telegram.handleUpdate(id, secret, update);
  }
}

@ApiTags('telegram')
@ApiBearerAuth()
@Controller('users/me/telegram')
export class TelegramAccountController {
  constructor(private readonly telegram: TelegramService) {}

  @Delete()
  @HttpCode(204)
  @UserOnly()
  unlink(@Req() req: AppRequest, @CurrentPrincipal() p: Principal) {
    return this.telegram.unlink(req, userId(p));
  }
}

/** A brand connects its own bot. The token is write-only: it is never returned. */
@ApiTags('telegram')
@ApiBearerAuth()
@Controller('organizations/:orgId/integrations/telegram')
export class TelegramIntegrationController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  @RequirePermissions('org.integrations.manage')
  status(@CurrentTenant() t: Tenant) {
    return this.telegram.status(t);
  }

  @Put()
  @UserOnly()
  @RequirePermissions('org.integrations.manage')
  @RequireFeature('telegram_mini_app')
  @ApiZodBody(connectBotSchema)
  connect(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(connectBotSchema)) body: z.infer<typeof connectBotSchema>) {
    return this.telegram.connect(req, t, body.botToken);
  }

  @Delete()
  @HttpCode(204)
  @UserOnly()
  @RequirePermissions('org.integrations.manage')
  disconnect(@Req() req: AppRequest, @CurrentTenant() t: Tenant) {
    return this.telegram.disconnect(req, t);
  }
}

/** Storefront "Поддержка" form → the store team's Telegram. */
@ApiTags('storefront')
@Controller('storefront/:store')
export class SupportController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('support')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiZodBody(supportMessageSchema)
  support(@Param('store') store: string, @Body(new ZodPipe(supportMessageSchema)) body: SupportMessage) {
    return this.telegram.sendSupport(store, body);
  }
}
