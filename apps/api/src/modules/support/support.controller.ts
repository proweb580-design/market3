import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  connectBotSchema,
  supportMessageSchema,
  supportTicketUpdateSchema,
  supportTicketsQuerySchema,
  type SupportMessage,
} from '@repo/shared';
import type { z } from 'zod';
import { CurrentPrincipal, CurrentTenant, Public, Req, RequirePermissions, UserOnly } from '../../common/decorators.js';
import type { AppRequest, Principal, Tenant } from '../../common/principal.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../../common/zod.js';
import { SupportService } from './support.service.js';

/** Storefront "Поддержка" form. */
@ApiTags('storefront')
@Controller('storefront/:store')
export class SupportFormController {
  constructor(private readonly support: SupportService) {}

  @Post('support')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiZodBody(supportMessageSchema)
  create(@Param('store') store: string, @Body(new ZodPipe(supportMessageSchema)) body: SupportMessage) {
    return this.support.create(store, body);
  }
}

/** The team's ticket list. Support sits with orders: whoever handles orders answers buyers. */
@ApiTags('support')
@ApiBearerAuth()
@Controller('organizations/:orgId/support/tickets')
export class SupportTicketsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermissions('orders.read')
  @ApiZodQuery(supportTicketsQuerySchema)
  list(@CurrentTenant() t: Tenant, @Query(new ZodPipe(supportTicketsQuerySchema)) q: z.infer<typeof supportTicketsQuerySchema>) {
    return this.support.list(t, q);
  }

  @Patch(':ticketId')
  @UserOnly()
  @RequirePermissions('orders.manage')
  @ApiZodBody(supportTicketUpdateSchema)
  update(
    @Req() req: AppRequest,
    @CurrentTenant() t: Tenant,
    @CurrentPrincipal() p: Principal,
    @Param('ticketId', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(supportTicketUpdateSchema)) body: z.infer<typeof supportTicketUpdateSchema>,
  ) {
    const who = (p as { user: { email: string | null } }).user.email ?? 'Dashboard';
    return this.support.setStatus(req, t, id, body.status, who);
  }
}

/** The second bot: posts tickets to the team's Telegram group. The token is write-only. */
@ApiTags('support')
@ApiBearerAuth()
@Controller('organizations/:orgId/integrations/telegram-support')
export class SupportBotController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermissions('org.integrations.manage')
  status(@CurrentTenant() t: Tenant) {
    return this.support.status(t);
  }

  @Put()
  @UserOnly()
  @RequirePermissions('org.integrations.manage')
  @ApiZodBody(connectBotSchema)
  connect(@Req() req: AppRequest, @CurrentTenant() t: Tenant, @Body(new ZodPipe(connectBotSchema)) body: z.infer<typeof connectBotSchema>) {
    return this.support.connect(req, t, body.botToken);
  }

  @Delete()
  @HttpCode(204)
  @UserOnly()
  @RequirePermissions('org.integrations.manage')
  disconnect(@Req() req: AppRequest, @CurrentTenant() t: Tenant) {
    return this.support.disconnect(req, t);
  }
}

@Controller('support')
export class SupportWebhookController {
  constructor(private readonly support: SupportService) {}

  @Post('webhook/:integrationId')
  @HttpCode(200)
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  webhook(@Param('integrationId', ParseUUIDPipe) id: string, @Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: unknown) {
    return this.support.handleUpdate(id, secret, update);
  }
}
