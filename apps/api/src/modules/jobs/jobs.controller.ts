import { Controller, Get, Headers, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators.js';
import { sha256 } from '../../common/crypto.js';
import { ENV, type Env } from '../../config/env.js';
import { SubscriptionsService } from '../billing/subscriptions.service.js';
import { OrdersService } from '../orders/orders.service.js';

/**
 * Scheduled jobs as HTTP endpoints, for hosts without a long-running process (Vercel Cron).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the endpoints are off.
 * Both jobs are idempotent, so a repeated or concurrent call is harmless.
 */
@ApiExcludeController()
@Public()
@Controller('internal/cron')
export class JobsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private authorize(header: string | undefined) {
    if (!this.env.CRON_SECRET) throw new ServiceUnavailableException('CRON_SECRET is not configured');
    const expected = Buffer.from(sha256(`Bearer ${this.env.CRON_SECRET}`));
    const given = Buffer.from(sha256(header ?? ''));
    if (!timingSafeEqual(expected, given)) throw new UnauthorizedException('Invalid cron credentials');
  }

  @Get('subscriptions')
  async runSubscriptions(@Headers('authorization') auth?: string) {
    this.authorize(auth);
    return this.subscriptions.runLifecycle();
  }

  @Get('orders')
  async runOrders(@Headers('authorization') auth?: string) {
    this.authorize(auth);
    return this.orders.expireStale();
  }
}
