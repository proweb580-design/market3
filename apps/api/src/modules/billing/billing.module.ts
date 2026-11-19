import { Global, Inject, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV, type Env } from '../../config/env.js';
import { AdminBillingController, OrganizationBillingController, PlansController, WebhooksController } from './billing.controller.js';
import { EntitlementsService } from './entitlements.service.js';
import { PAYMENT_PROVIDER } from './payments/payment-provider.js';
import { PaymentsService } from './payments/payments.service.js';
import { StripeProvider } from './payments/stripe.provider.js';
import { PlansService } from './plans.service.js';
import { SubscriptionGuard } from './subscription.guard.js';
import { SubscriptionsService } from './subscriptions.service.js';

const LIFECYCLE_EVERY_MS = 10 * 60_000;

@Global()
@Module({
  controllers: [PlansController, OrganizationBillingController, WebhooksController, AdminBillingController],
  providers: [
    EntitlementsService,
    PlansService,
    SubscriptionsService,
    PaymentsService,
    SubscriptionGuard,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => (env.STRIPE_SECRET_KEY ? new StripeProvider(new Stripe(env.STRIPE_SECRET_KEY), env.STRIPE_WEBHOOK_SECRET) : null),
    },
  ],
  exports: [EntitlementsService, SubscriptionsService, SubscriptionGuard, PaymentsService, PAYMENT_PROVIDER],
})
export class BillingModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Billing');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly subscriptions: SubscriptionsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** shortcut: in-process timer, one per API instance (the job is idempotent, so overlap is safe) — move to a BullMQ repeatable job with Redis in phase 10. */
  onApplicationBootstrap() {
    if (this.env.NODE_ENV === 'test') return;
    if (!this.env.STRIPE_SECRET_KEY) this.logger.warn('STRIPE_SECRET_KEY not set: paid checkout is disabled');
    this.timer = setInterval(() => {
      this.subscriptions.runLifecycle().catch((e: unknown) => this.logger.error(`lifecycle run failed: ${String(e)}`));
    }, LIFECYCLE_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
