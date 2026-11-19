import { Inject, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { CheckoutController, OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

const EXPIRY_EVERY_MS = 5 * 60_000;

@Module({
  controllers: [CheckoutController, OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Orders');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** shortcut: in-process timer like the billing lifecycle (idempotent, overlap-safe) — move to a Redis-backed job in phase 10. */
  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.orders.expireStale().catch((e: unknown) => this.logger.error(`order expiry failed: ${String(e)}`));
    }, EXPIRY_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
