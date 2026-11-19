import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PaginationQuery, paymentsQuerySchema } from '@repo/shared';
import { z } from 'zod';
import { sha256 } from '../../../common/crypto.js';
import { pageArgs, parseSort, toPage } from '../../../common/pagination.js';
import type { AppRequest } from '../../../common/principal.js';
import { ENV, type Env } from '../../../config/env.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { cancelUnpaidOrder, markOrderPaid, markOrderRefunded } from '../../orders/order-lifecycle.js';
import { PlansService } from '../plans.service.js';
import { SubscriptionsService } from '../subscriptions.service.js';
import { PAYMENT_PROVIDER, type CheckoutState, type PaymentProvider, ProviderError, type ProviderEvent, WebhookSignatureError } from './payment-provider.js';

type Tx = Prisma.TransactionClient;
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

const paymentSelect = {
  id: true,
  organizationId: true,
  purpose: true,
  subscriptionId: true,
  provider: true,
  amountMinor: true,
  currency: true,
  status: true,
  failureReason: true,
  confirmationUrl: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  transactions: { select: { id: true, type: true, amountMinor: true, currency: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly subscriptions: SubscriptionsService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
  ) {}

  private requireProvider() {
    if (!this.provider) throw new ServiceUnavailableException('Online payments are not configured (STRIPE_SECRET_KEY)');
    return this.provider;
  }

  // ── checkout ──

  /**
   * Starts paying for a plan period: a PENDING payment row, then a hosted checkout page.
   * With an Idempotency-Key, a retried request returns the first response instead of a second payment.
   */
  async checkout(req: AppRequest, organizationId: string, planCode: string, idempotencyKey?: string) {
    const provider = this.requireProvider();
    const scope = `org:${organizationId}`;
    const requestHash = sha256(JSON.stringify({ planCode }));

    if (idempotencyKey) {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) throw new BadRequestException('Idempotency-Key must be 8–100 URL-safe characters');
      const prior = await this.db.idempotencyKey.findUnique({ where: { scope_key: { scope, key: idempotencyKey } } });
      if (prior && prior.expiresAt > new Date()) {
        if (prior.requestHash !== requestHash) throw new UnprocessableEntityException('Idempotency-Key was already used with a different request');
        if (prior.responseBody) return prior.responseBody as object;
        throw new ConflictException('The original request with this Idempotency-Key is still in progress');
      }
      if (prior) await this.db.idempotencyKey.delete({ where: { id: prior.id } });
      try {
        await this.db.idempotencyKey.create({ data: { scope, key: idempotencyKey, requestHash, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS) } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw new ConflictException('The original request with this Idempotency-Key is still in progress');
        throw error;
      }
    }

    try {
      const response = await this.startCheckout(req, provider, organizationId, planCode);
      if (idempotencyKey) {
        await this.db.idempotencyKey.update({ where: { scope_key: { scope, key: idempotencyKey } }, data: { responseStatus: 201, responseBody: response } });
      }
      return response;
    } catch (error) {
      // A failed attempt must not pin the key: the client may retry it.
      if (idempotencyKey) await this.db.idempotencyKey.deleteMany({ where: { scope, key: idempotencyKey } });
      throw error;
    }
  }

  private async startCheckout(req: AppRequest, provider: PaymentProvider, organizationId: string, planCode: string) {
    const plan = await this.plans.purchasable(planCode);
    if (plan.priceMinor <= 0n) throw new UnprocessableEntityException('This plan is free — no payment needed');
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true, name: true } });
    const actorId = req.principal?.kind === 'user' ? req.principal.user.id : null;

    const payment = await this.db.$transaction(async (tx) => {
      await this.subscriptions.lockOrganization(tx, organizationId);
      const live = await this.subscriptions.ensureLive(tx, organizationId, actorId);
      if (!live) throw new ServiceUnavailableException('Billing is not initialised (FREE plan missing)');
      const row = await tx.payment.create({
        data: {
          organizationId,
          purpose: 'SUBSCRIPTION',
          subscriptionId: live.id,
          provider: provider.code,
          amountMinor: plan.priceMinor,
          currency: plan.currency,
          // The plan is captured here; webhooks never decide what was bought, only whether it was paid.
          metadata: { planId: plan.id, planCode: plan.code, interval: plan.interval, initiatedBy: actorId },
        },
      });
      await this.audit.record(req, { action: 'payment.created', organizationId, entityType: 'payment', entityId: row.id, metadata: { plan: plan.code } }, tx);
      return row;
    });

    const back = `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/dashboard/${org.slug}/billing?payment=${payment.id}`;
    try {
      const session = await provider.createCheckout({
        paymentId: payment.id,
        organizationId,
        amountMinor: plan.priceMinor,
        currency: plan.currency,
        title: `${plan.name} plan · ${org.name}`,
        successUrl: `${back}&result=success`,
        cancelUrl: `${back}&result=cancel`,
        customerEmail: req.principal?.kind === 'user' ? req.principal.user.email : null,
      });
      await this.db.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: session.providerPaymentId, confirmationUrl: session.checkoutUrl },
      });
      return { paymentId: payment.id, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt.toISOString() };
    } catch (error) {
      await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'checkout_creation_failed' } });
      if (error instanceof ProviderError) {
        this.logger.warn(`checkout creation failed for ${payment.id}: ${error.message}`);
        throw new BadGatewayException('Payment provider is unavailable, please try again');
      }
      throw error;
    }
  }

  // ── status ──

  /** The buyer is back from the checkout page: ask the provider directly instead of waiting for the webhook. */
  async sync(organizationId: string, paymentId: string) {
    const payment = await this.db.payment.findFirst({ where: { id: paymentId, organizationId }, select: { status: true, providerPaymentId: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'PENDING' && payment.providerPaymentId) {
      await this.applyCheckout(await this.requireProvider().getCheckout(payment.providerPaymentId));
    }
    return this.getForOrganization(organizationId, paymentId);
  }

  async getForOrganization(organizationId: string, paymentId: string) {
    const p = await this.db.payment.findFirst({ where: { id: paymentId, organizationId }, select: paymentSelect });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  // ── webhooks ──

  /**
   * Verified, de-duplicated webhook processing. Each provider event id is stored once (unique index);
   * redeliveries of a processed event are acknowledged without side effects. A failed attempt stays FAILED
   * and is processed again on the provider's retry.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const provider = this.requireProvider();
    if (!rawBody) throw new BadRequestException('Raw body required');
    let event: ProviderEvent;
    try {
      event = provider.parseWebhook(rawBody, signature);
    } catch (error) {
      if (error instanceof WebhookSignatureError) throw new BadRequestException('Invalid webhook signature');
      throw error;
    }

    const summary = { kind: event.kind, ...('providerPaymentId' in event ? { providerPaymentId: event.providerPaymentId, outcome: event.outcome } : {}), ...('refundId' in event ? { refundId: event.refundId, status: event.status } : {}) };
    let row;
    try {
      row = await this.db.webhookEvent.create({
        data: { provider: provider.code, eventId: event.id, eventType: event.type, payload: summary as Prisma.InputJsonValue },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      row = await this.db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: provider.code, eventId: event.id } } });
      if (row.status === 'PROCESSED' || row.status === 'IGNORED') return { received: true, duplicate: true };
      if (row.status === 'RECEIVED' && Date.now() - row.receivedAt.getTime() < 120_000) throw new ConflictException('Event is being processed');
      // Claim a FAILED (or stale RECEIVED) row for this retry; a parallel delivery that loses the claim backs off.
      // Even a double run is harmless: applyCheckout/applyRefund lock the payment and only move PENDING ones.
      const { count } = await this.db.webhookEvent.updateMany({ where: { id: row.id, status: row.status, receivedAt: row.receivedAt }, data: { status: 'RECEIVED', receivedAt: new Date() } });
      if (!count) throw new ConflictException('Event is being processed');
    }

    try {
      const result = event.kind === 'checkout' ? await this.applyCheckout(event) : event.kind === 'refund' ? await this.applyRefund(event) : 'ignored';
      await this.db.webhookEvent.update({ where: { id: row.id }, data: { status: result === 'ignored' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), error: null } });
      return { received: true };
    } catch (error) {
      await this.db.webhookEvent.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(error instanceof Error ? error.message : error).slice(0, 500) } });
      throw error;
    }
  }

  /** Applies a checkout result. Idempotent: only a PENDING payment can change state. */
  async applyCheckout(state: CheckoutState): Promise<'applied' | 'ignored'> {
    return this.db.$transaction(async (tx) => {
      const found = await tx.payment.findFirst({ where: { providerPaymentId: state.providerPaymentId }, select: { id: true } });
      if (!found) return 'ignored'; // not ours (another integration on the same Stripe account)
      await tx.$queryRaw`SELECT id FROM "app"."payments" WHERE id = ${found.id}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
      // An order payment canceled on our side (brand cancel, expiry) can still be paid at the provider: record that money
      // instead of dropping it, so it can be refunded.
      const lateOrderMoney = !!payment.orderId && payment.status === 'CANCELED' && state.outcome === 'paid';
      if ((payment.status !== 'PENDING' && !lateOrderMoney) || state.outcome === 'pending') return 'ignored';

      if (state.outcome === 'expired' || state.outcome === 'failed') {
        await tx.payment.update({ where: { id: payment.id }, data: { status: state.outcome === 'expired' ? 'CANCELED' : 'FAILED', failureReason: state.outcome } });
        if (payment.orderId) await cancelUnpaidOrder(tx, payment.orderId);
        return 'applied';
      }

      // Paid: the amount and currency must be exactly what we asked for — never trust the event for that.
      if (state.amountMinor !== payment.amountMinor || state.currency !== payment.currency) {
        this.logger.error(`amount mismatch on payment ${payment.id}`);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'amount_mismatch' } });
        await this.audit.record(null, { action: 'payment.amount_mismatch', organizationId: payment.organizationId, entityType: 'payment', entityId: payment.id, metadata: { expected: `${payment.amountMinor} ${payment.currency}`, received: `${state.amountMinor} ${state.currency}` } }, tx);
        return 'applied';
      }

      if (payment.orderId) {
        // Order payment: the order was captured at checkout; the webhook only says whether it was paid.
        const result = await markOrderPaid(tx, payment.orderId);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED' } });
        await tx.transaction.create({
          data: { paymentId: payment.id, type: 'CHARGE', amountMinor: payment.amountMinor, currency: payment.currency, status: 'SUCCEEDED', providerTransactionId: state.providerTransactionId },
        });
        const action = result === 'paid_after_cancel' ? 'order.paid_after_cancel' : 'order.paid';
        await this.audit.record(null, { action, organizationId: payment.organizationId, entityType: 'order', entityId: payment.orderId, metadata: { paymentId: payment.id } }, tx);
        return 'applied';
      }

      const meta = payment.metadata as { planId: string };
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: meta.planId } });
      const sub = await this.subscriptions.applyPaidPeriod(tx, payment.organizationId, plan);
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', subscriptionId: sub.id } });
      await tx.transaction.create({
        data: { paymentId: payment.id, type: 'CHARGE', amountMinor: payment.amountMinor, currency: payment.currency, status: 'SUCCEEDED', providerTransactionId: state.providerTransactionId },
      });
      await this.audit.record(null, { action: 'payment.succeeded', organizationId: payment.organizationId, entityType: 'payment', entityId: payment.id, metadata: { plan: plan.code } }, tx);
      return 'applied';
    });
  }

  private async applyRefund(event: Extract<ProviderEvent, { kind: 'refund' }>): Promise<'applied' | 'ignored'> {
    return this.db.$transaction(async (tx) => {
      const charge = await tx.transaction.findFirst({ where: { type: 'CHARGE', providerTransactionId: event.providerTransactionId }, select: { paymentId: true } });
      if (!charge) return 'ignored';
      await tx.$queryRaw`SELECT id FROM "app"."payments" WHERE id = ${charge.paymentId}::uuid FOR UPDATE`;
      await tx.transaction.upsert({
        where: { paymentId_providerTransactionId: { paymentId: charge.paymentId, providerTransactionId: event.refundId } },
        update: { status: event.status },
        create: { paymentId: charge.paymentId, type: 'REFUND', amountMinor: event.amountMinor, currency: event.currency, status: event.status, providerTransactionId: event.refundId },
      });
      await this.recomputeRefundStatus(tx, charge.paymentId);
      return 'applied';
    });
  }

  private async recomputeRefundStatus(tx: Tx, paymentId: string) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amountMinor: true, status: true, orderId: true } });
    const refunds = await tx.transaction.findMany({ where: { paymentId, type: 'REFUND', status: 'SUCCEEDED' }, select: { amountMinor: true } });
    const refunded = refunds.reduce((s, r) => s + r.amountMinor, 0n);
    const status = refunded >= payment.amountMinor ? 'REFUNDED' : refunded > 0n ? 'PARTIALLY_REFUNDED' : 'SUCCEEDED';
    if (status !== payment.status) await tx.payment.update({ where: { id: paymentId }, data: { status } });
    if (status === 'REFUNDED' && payment.orderId) await markOrderRefunded(tx, payment.orderId);
  }

  // ── refunds (platform admin) ──

  async refund(req: AppRequest, paymentId: string, amountMinor?: number, reason?: string) {
    const provider = this.requireProvider();
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { transactions: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new ConflictException('Only paid payments can be refunded');
    const charge = payment.transactions.find((t) => t.type === 'CHARGE' && t.status === 'SUCCEEDED' && t.providerTransactionId);
    if (!charge) throw new ConflictException('No refundable charge on this payment');

    // Pending refunds count against the balance too, so two quick clicks cannot refund twice.
    const reserved = payment.transactions.filter((t) => t.type === 'REFUND' && t.status !== 'FAILED').reduce((s, t) => s + t.amountMinor, 0n);
    const remaining = payment.amountMinor - reserved;
    const amount = amountMinor === undefined ? remaining : BigInt(amountMinor);
    if (amount <= 0n || amount > remaining) throw new UnprocessableEntityException(`Refundable amount is ${remaining}`);

    const attempt = payment.transactions.filter((t) => t.type === 'REFUND').length + 1;
    const result = await provider.refund(charge.providerTransactionId!, amount, `refund:${payment.id}:${attempt}`).catch((error: unknown) => {
      if (error instanceof ProviderError) throw new BadGatewayException(`Refund failed at the provider: ${error.message}`);
      throw error;
    });

    await this.db.$transaction(async (tx) => {
      await tx.transaction.upsert({
        where: { paymentId_providerTransactionId: { paymentId: payment.id, providerTransactionId: result.refundId } },
        update: { status: result.status },
        create: { paymentId: payment.id, type: 'REFUND', amountMinor: amount, currency: payment.currency, status: result.status, providerTransactionId: result.refundId },
      });
      await this.recomputeRefundStatus(tx, payment.id);
      await this.audit.record(req, { action: 'payment.refunded', organizationId: payment.organizationId, entityType: 'payment', entityId: payment.id, metadata: { amountMinor: amount.toString(), reason } }, tx);
    });
    return this.db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: paymentSelect });
  }

  // ── lists ──

  async list(query: z.infer<typeof paymentsQuerySchema>, organizationId?: string) {
    const where: Prisma.PaymentWhereInput = {
      ...(organizationId ? { organizationId } : query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const q = query as PaginationQuery;
    const [items, total] = await Promise.all([
      this.db.payment.findMany({ where, orderBy: parseSort(query.sort, ['createdAt', 'amountMinor', 'status'], { field: 'createdAt', dir: 'desc' }), ...pageArgs(q), select: paymentSelect }),
      this.db.payment.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async transactions(organizationId: string, query: PaginationQuery) {
    const where = { payment: { organizationId } };
    const [items, total] = await Promise.all([
      this.db.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(query),
        select: { id: true, paymentId: true, type: true, amountMinor: true, currency: true, status: true, createdAt: true },
      }),
      this.db.transaction.count({ where }),
    ]);
    return toPage(items, total, query);
  }
}
