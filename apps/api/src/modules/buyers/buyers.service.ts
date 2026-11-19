import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginationQuery } from '@repo/shared';
import { pageArgs, toPage } from '../../common/pagination.js';
import type { AppRequest } from '../../common/principal.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

const MAX_WISHLIST = 200;

/** The signed-in buyer's own data across all stores: their orders and their wishlists. */
@Injectable()
export class BuyersService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async orders(userId: string, q: PaginationQuery) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          status: true,
          currency: true,
          totalMinor: true,
          createdAt: true,
          organization: { select: { slug: true, name: true } },
          _count: { select: { items: true } },
        },
        ...pageArgs(q),
      }),
      this.db.order.count({ where }),
    ]);
    const items = rows.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      currency: o.currency,
      totalMinor: Number(o.totalMinor),
      createdAt: o.createdAt,
      itemCount: o._count.items,
      store: o.organization,
    }));
    return toPage(items, total, q);
  }

  /**
   * Attaches guest orders placed with the user's own *verified* email to their account (AuthGuard only stores
   * confirmed emails; Telegram users have none, so nothing is claimed for them).
   */
  async claimGuestOrders(req: AppRequest, user: { id: string; email: string | null }) {
    if (!user.email) return { claimed: 0 };
    const { count } = await this.db.order.updateMany({ where: { userId: null, contactEmail: user.email }, data: { userId: user.id } });
    if (count) await this.audit.record(req, { action: 'order.claimed', entityType: 'user', entityId: user.id, metadata: { count } });
    return { claimed: count };
  }

  // ── wishlist ──

  private async store(slug: string) {
    const org = await this.db.organization.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
    if (!org) throw new NotFoundException('Store not found');
    return org.id;
  }

  async wishlist(userId: string, storeSlug: string) {
    const organizationId = await this.store(storeSlug);
    const rows = await this.db.wishlistItem.findMany({
      where: { userId, organizationId, product: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: { product: { select: { slug: true } } },
    });
    return { slugs: rows.map((r) => r.product.slug) };
  }

  async addToWishlist(userId: string, storeSlug: string, productSlug: string) {
    const organizationId = await this.store(storeSlug);
    const product = await this.db.product.findFirst({ where: { organizationId, slug: productSlug, status: 'ACTIVE' }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const existing = await this.db.wishlistItem.findUnique({ where: { userId_productId: { userId, productId: product.id } } });
    if (!existing) {
      if ((await this.db.wishlistItem.count({ where: { userId, organizationId } })) >= MAX_WISHLIST) throw new ConflictException('Wishlist is full');
      await this.db.wishlistItem.create({ data: { userId, productId: product.id, organizationId } }).catch((e: { code?: string }) => {
        if (e.code !== 'P2002') throw e; // a parallel request added it first: same end state
      });
    }
    return this.wishlist(userId, storeSlug);
  }

  async removeFromWishlist(userId: string, storeSlug: string, productSlug: string) {
    const organizationId = await this.store(storeSlug);
    await this.db.wishlistItem.deleteMany({ where: { userId, organizationId, product: { slug: productSlug } } });
    return this.wishlist(userId, storeSlug);
  }
}
