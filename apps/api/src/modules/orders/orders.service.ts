import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { OrderCheckoutInput, PaginationQuery, Quote, StorefrontContent, ordersQuerySchema } from '@repo/shared';
import type { z } from 'zod';
import { randomToken, sha256 } from '../../common/crypto.js';
import { pageArgs, parseSort, toPage } from '../../common/pagination.js';
import type { AppRequest, Principal, Tenant } from '../../common/principal.js';
import { ENV, type Env } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider, ProviderError } from '../billing/payments/payment-provider.js';
import { PaymentsService } from '../billing/payments/payments.service.js';
import { cancelUnpaidOrder } from './order-lifecycle.js';

const MAX_OPEN_ORDERS_PER_EMAIL = 3;
/** Stripe sessions live 30 min; after this an unpaid order is released. */
const ORDER_TTL_MS = 40 * 60_000;

const VARIANT_INCLUDE = {
  product: { select: { slug: true, title: true, status: true } },
  optionValues: { include: { optionValue: { select: { value: true, option: { select: { position: true } } } } } },
} satisfies Prisma.ProductVariantInclude;
type VariantRow = Prisma.ProductVariantGetPayload<{ include: typeof VARIANT_INCLUDE }>;

const variantTitle = (v: VariantRow) =>
  v.optionValues
    .toSorted((a, b) => a.optionValue.option.position - b.optionValue.option.position)
    .map((l) => l.optionValue.value)
    .join(' / ') || 'Default';

const ORDER_INCLUDE = {
  items: { orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, confirmationUrl: true, provider: true } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
  ) {}

  private async activeStore(slug: string) {
    const org = await this.db.organization.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null } });
    if (!org) throw new NotFoundException('Store not found');
    return org;
  }

  private shipping(settings: unknown, subtotal: bigint) {
    const s = (settings as { storefront?: Partial<StorefrontContent['settings']> } | null)?.storefront;
    const threshold = s?.freeShippingThresholdMinor;
    return threshold != null && subtotal >= BigInt(threshold) ? 0n : BigInt(s?.shippingFlatMinor ?? 0);
  }

  // ── quote ──

  /** Prices a cart from the database. The same numbers checkout will charge — nothing here comes from the client. */
  async quote(slug: string, lines: { variantId: string; quantity: number }[]): Promise<Quote> {
    const org = await this.activeStore(slug);
    const variants = await this.db.productVariant.findMany({
      where: { organizationId: org.id, id: { in: lines.map((l) => l.variantId) }, isActive: true, product: { status: 'ACTIVE' } },
      include: VARIANT_INCLUDE,
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const out = lines.map((l) => {
      const v = byId.get(l.variantId);
      if (!v) return { variantId: l.variantId, productSlug: '', productTitle: '', variantTitle: '', unitPriceMinor: 0, quantity: l.quantity, totalMinor: 0, available: 0, ok: false };
      return {
        variantId: v.id,
        productSlug: v.product.slug,
        productTitle: v.product.title,
        variantTitle: variantTitle(v),
        unitPriceMinor: Number(v.priceMinor),
        quantity: l.quantity,
        totalMinor: Number(v.priceMinor) * l.quantity,
        available: v.stock,
        ok: v.stock >= l.quantity,
      };
    });
    const subtotal = out.reduce((s, l) => s + BigInt(l.totalMinor), 0n);
    const shippingMinor = this.shipping(org.settings, subtotal);
    return {
      currency: org.currency,
      lines: out,
      subtotalMinor: Number(subtotal),
      shippingMinor: Number(shippingMinor),
      totalMinor: Number(subtotal + shippingMinor),
      ok: out.every((l) => l.ok),
    };
  }

  // ── checkout ──

  async checkout(req: AppRequest, slug: string, input: OrderCheckoutInput) {
    if (!this.provider) throw new ServiceUnavailableException('Online payments are not configured (STRIPE_SECRET_KEY)');
    const provider = this.provider;
    const org = await this.activeStore(slug);
    const principal: Principal | undefined = req.principal;
    const userId = principal?.kind === 'user' ? principal.user.id : null;
    const ids = input.lines.map((l) => l.variantId).toSorted(); // fixed lock order → no deadlocks between buyers
    const qty = new Map(input.lines.map((l) => [l.variantId, l.quantity]));

    const token = randomToken(32);
    const { order, payment } = await this.db.$transaction(async (tx) => {
      const open = await tx.order.count({ where: { organizationId: org.id, contactEmail: input.email, status: 'PENDING_PAYMENT' } });
      if (open >= MAX_OPEN_ORDERS_PER_EMAIL) throw new HttpException('Too many unpaid orders — pay or wait for them to expire', HttpStatus.TOO_MANY_REQUESTS);

      // Reserve stock first, atomically: the UPDATE only succeeds while enough units remain (the DB CHECK stock >= 0 backs it up).
      for (const id of ids) {
        const { count } = await tx.productVariant.updateMany({
          where: { id, organizationId: org.id, isActive: true, product: { status: 'ACTIVE' }, stock: { gte: qty.get(id)! } },
          data: { stock: { decrement: qty.get(id)! } },
        });
        if (!count) throw new ConflictException('Some items are unavailable or out of stock — review your cart');
      }
      const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: VARIANT_INCLUDE });
      const lines = variants.map((v) => ({ v, quantity: qty.get(v.id)!, total: v.priceMinor * BigInt(qty.get(v.id)!) }));
      const subtotal = lines.reduce((s, l) => s + l.total, 0n);
      const shipping = this.shipping(org.settings, subtotal);
      const total = subtotal + shipping;
      if (total <= 0n) throw new UnprocessableEntityException('Order total must be greater than zero');

      const { nextOrderNumber } = await tx.organization.update({ where: { id: org.id }, data: { nextOrderNumber: { increment: 1 } }, select: { nextOrderNumber: true } });
      const created = await tx.order.create({
        data: {
          organizationId: org.id,
          number: nextOrderNumber - 1,
          userId,
          source: input.channel === 'telegram' ? 'TELEGRAM' : 'WEB',
          currency: org.currency,
          subtotalMinor: subtotal,
          shippingMinor: shipping,
          totalMinor: total,
          contactEmail: input.email,
          contactPhone: input.phone ?? null,
          shippingAddress: input.shippingAddress,
          note: input.note ?? null,
          accessTokenHash: sha256(token),
          items: {
            create: lines.map((l) => ({
              variantId: l.v.id,
              productTitle: l.v.product.title,
              variantTitle: variantTitle(l.v),
              sku: l.v.sku,
              unitPriceMinor: l.v.priceMinor,
              quantity: l.quantity,
              totalMinor: l.total,
            })),
          },
        },
      });
      const pay = await tx.payment.create({
        data: { organizationId: org.id, purpose: 'ORDER', orderId: created.id, provider: provider.code, amountMinor: total, currency: org.currency, metadata: { orderNumber: created.number } },
      });
      await this.audit.record(req, { action: 'order.created', organizationId: org.id, entityType: 'order', entityId: created.id, metadata: { number: created.number, totalMinor: total.toString() } }, tx);
      return { order: created, payment: pay };
    });

    // Both channels return to the website: the payment page opens in the system browser (not inside Telegram), so the order page lives on the site.
    const base = `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/s`;
    const back = `${base}/${org.slug}/orders/${order.id}?token=${token}`;
    try {
      const session = await provider.createCheckout({
        paymentId: payment.id,
        organizationId: org.id,
        amountMinor: payment.amountMinor,
        currency: org.currency,
        title: `${org.name} · order #${order.number}`,
        successUrl: `${back}&result=success`,
        cancelUrl: `${back}&result=cancel`,
        customerEmail: input.email,
      });
      await this.db.payment.update({ where: { id: payment.id }, data: { providerPaymentId: session.providerPaymentId, confirmationUrl: session.checkoutUrl } });
      return { orderId: order.id, number: order.number, token, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt.toISOString() };
    } catch (error) {
      // No payment page, no order: release the reserved stock right away.
      await this.db.$transaction(async (tx) => {
        await cancelUnpaidOrder(tx, order.id);
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'checkout_creation_failed' } });
      });
      if (error instanceof ProviderError) {
        this.logger.warn(`checkout creation failed for order ${order.id}: ${error.message}`);
        throw new BadGatewayException('Payment provider is unavailable, please try again');
      }
      throw error;
    }
  }

  // ── buyer view ──

  private buyerDto(o: OrderRow) {
    const pay = o.payments[0];
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      currency: o.currency,
      subtotalMinor: Number(o.subtotalMinor),
      shippingMinor: Number(o.shippingMinor),
      totalMinor: Number(o.totalMinor),
      contactEmail: o.contactEmail,
      shippingAddress: o.shippingAddress,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      paymentProvider: pay?.provider ?? null,
      items: o.items.map((i) => ({ productTitle: i.productTitle, variantTitle: i.variantTitle, unitPriceMinor: Number(i.unitPriceMinor), quantity: i.quantity, totalMinor: Number(i.totalMinor) })),
      /** Lets the buyer finish paying while the payment page is still open. */
      payUrl: o.status === 'PENDING_PAYMENT' && pay?.status === 'PENDING' ? pay.confirmationUrl : null,
    };
  }

  /** The buyer's own order: proven by the checkout token or by being the signed-in buyer. Anything else is 404. */
  async getForBuyer(req: AppRequest, slug: string, orderId: string, token?: string) {
    const org = await this.activeStore(slug);
    const found = await this.db.order.findFirst({ where: { id: orderId, organizationId: org.id }, include: ORDER_INCLUDE });
    const principal = req.principal;
    const byToken = !!token && !!found?.accessTokenHash && sha256(token) === found.accessTokenHash;
    const byUser = principal?.kind === 'user' && !!found?.userId && found.userId === principal.user.id;
    if (!found || (!byToken && !byUser)) throw new NotFoundException('Order not found');

    // The buyer is back from the payment page: ask the provider instead of waiting for the webhook.
    if (found.status === 'PENDING_PAYMENT' && this.provider) {
      const pending = await this.db.payment.findFirst({ where: { orderId: found.id, status: 'PENDING', providerPaymentId: { not: null } }, select: { id: true } });
      if (pending) {
        await this.payments.sync(org.id, pending.id).catch((e: unknown) => this.logger.warn(`order sync failed: ${String(e)}`));
        return this.buyerDto(await this.db.order.findUniqueOrThrow({ where: { id: found.id }, include: ORDER_INCLUDE }));
      }
    }
    return this.buyerDto(found);
  }

  // ── brand side ──

  private brandDto(o: OrderRow) {
    return { ...this.buyerDto(o), source: o.source, contactPhone: o.contactPhone, note: o.note, userId: o.userId, canceledAt: o.canceledAt, payUrl: undefined, paymentStatus: o.payments[0]?.status ?? null };
  }

  async list(tenant: Tenant, q: PaginationQuery & z.infer<typeof ordersQuerySchema>) {
    const number = /^#?(\d{1,9})$/.exec(q.q ?? '')?.[1];
    const where: Prisma.OrderWhereInput = {
      organizationId: tenant.organizationId,
      ...(q.status && { status: q.status }),
      ...(q.q && { OR: [...(number ? [{ number: Number(number) }] : []), { contactEmail: { contains: q.q.toLowerCase() } }] }),
    };
    const [rows, total] = await Promise.all([
      this.db.order.findMany({ where, orderBy: parseSort(q.sort, ['createdAt', 'number', 'totalMinor', 'status'], { field: 'createdAt', dir: 'desc' }), include: ORDER_INCLUDE, ...pageArgs(q) }),
      this.db.order.count({ where }),
    ]);
    return toPage(rows.map((o) => this.brandDto(o)), total, q);
  }

  async get(tenant: Tenant, orderId: string) {
    const o = await this.db.order.findFirst({ where: { id: orderId, organizationId: tenant.organizationId }, include: ORDER_INCLUDE });
    if (!o) throw new NotFoundException('Order not found');
    return this.brandDto(o);
  }

  async fulfill(req: AppRequest, tenant: Tenant, orderId: string) {
    const { count } = await this.db.order.updateMany({ where: { id: orderId, organizationId: tenant.organizationId, status: 'PAID' }, data: { status: 'FULFILLED' } });
    if (!count) await this.explainNoChange(tenant, orderId, 'Only paid orders can be fulfilled');
    await this.audit.record(req, { action: 'order.fulfilled', organizationId: tenant.organizationId, entityType: 'order', entityId: orderId });
    return this.get(tenant, orderId);
  }

  /** Only an unpaid order can be canceled here; paid ones are refunded by the platform (money moves through the provider). */
  async cancel(req: AppRequest, tenant: Tenant, orderId: string) {
    await this.db.$transaction(async (tx) => {
      const exists = await tx.order.findFirst({ where: { id: orderId, organizationId: tenant.organizationId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Order not found');
      if (!(await cancelUnpaidOrder(tx, orderId))) throw new ConflictException('Only orders waiting for payment can be canceled');
      await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELED', failureReason: 'canceled_by_brand' } });
      await this.audit.record(req, { action: 'order.canceled', organizationId: tenant.organizationId, entityType: 'order', entityId: orderId }, tx);
    });
    return this.get(tenant, orderId);
  }

  private async explainNoChange(tenant: Tenant, orderId: string, conflict: string): Promise<never> {
    const exists = await this.db.order.findFirst({ where: { id: orderId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Order not found');
    throw new ConflictException(conflict);
  }

  // ── expiry job ──

  /**
   * Releases stock held by unpaid orders. Before cancelling, it asks the provider once more: a payment whose webhook
   * was lost still ends up PAID instead of being thrown away. Idempotent; safe to run on several instances.
   */
  async expireStale(now = new Date()) {
    const stale = await this.db.order.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(now.getTime() - ORDER_TTL_MS) } },
      select: { id: true, organizationId: true },
      take: 100,
    });
    let canceled = 0;
    for (const o of stale) {
      try {
        const pending = await this.db.payment.findFirst({ where: { orderId: o.id, status: 'PENDING', providerPaymentId: { not: null } }, select: { id: true } });
        if (pending && this.provider) await this.payments.sync(o.organizationId, pending.id).catch((e: unknown) => this.logger.warn(`sync failed for order ${o.id}: ${String(e)}`));
        await this.db.$transaction(async (tx) => {
          if (!(await cancelUnpaidOrder(tx, o.id))) return;
          await tx.payment.updateMany({ where: { orderId: o.id, status: 'PENDING' }, data: { status: 'CANCELED', failureReason: 'expired' } });
          await this.audit.record(null, { action: 'order.expired', organizationId: o.organizationId, entityType: 'order', entityId: o.id }, tx);
          canceled += 1;
        });
      } catch (error) {
        this.logger.error(`expiring order ${o.id} failed: ${String(error)}`);
      }
    }
    return { canceled };
  }
}
