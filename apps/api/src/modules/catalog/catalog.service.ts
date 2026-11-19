import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CollectionInput, PaginationQuery, ProductInput, SizeChartInput, StorefrontContent } from '@repo/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { pageArgs, parseSort, toPage } from '../../common/pagination.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SECTION_BY_TYPE, writeCollection, writeProduct, writeStorefrontContent } from './catalog-writer.js';
import { ART_MIME, mediaUrl } from './view.js';

const PRODUCT_INCLUDE = {
  options: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
  variants: { orderBy: { position: 'asc' }, include: { optionValues: { include: { optionValue: { include: { option: { select: { name: true } } } } } } } },
  media: { orderBy: { position: 'asc' }, include: { mediaFile: true } },
  collections: { select: { collectionId: true } },
} satisfies Prisma.ProductInclude;

type ProductWithAll = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

// Big products (many variants) are written row by row; give the transaction room.
const TX = { timeout: 20_000 };

/** Brand-side catalogue and storefront content management (always scoped to the tenant from the URL). */
@Injectable()
export class CatalogService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private media = (f: { id: string; storageKey: string; mimeType: string; alt: string | null; width: number | null; height: number | null; sizeBytes: bigint; meta: unknown; createdAt: Date }) => ({
    id: f.id,
    mimeType: f.mimeType,
    alt: f.alt,
    width: f.width,
    height: f.height,
    sizeBytes: f.sizeBytes,
    url: f.mimeType === ART_MIME ? null : mediaUrl(this.env.SUPABASE_URL, f.storageKey),
    art: f.mimeType === ART_MIME ? f.meta : null,
    createdAt: f.createdAt,
  });

  private productDto = (p: ProductWithAll) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    label: p.label,
    status: p.status,
    gender: p.gender,
    sizeChartId: p.sizeChartId,
    sortOrder: p.sortOrder,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    options: p.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ value: v.value, swatchHex: v.swatchHex })) })),
    variants: p.variants.map((v) => ({
      id: v.id,
      options: Object.fromEntries(v.optionValues.map((l) => [l.optionValue.option.name, l.optionValue.value])),
      sku: v.sku,
      priceMinor: v.priceMinor,
      compareAtPriceMinor: v.compareAtPriceMinor,
      stock: v.stock,
      isActive: v.isActive,
    })),
    media: p.media.map((m) => this.media(m.mediaFile)),
    collectionIds: p.collections.map((c) => c.collectionId),
  });

  // ── products ──

  async listProducts(tenant: Tenant, q: PaginationQuery & { status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; q?: string }) {
    const where: Prisma.ProductWhereInput = {
      organizationId: tenant.organizationId,
      ...(q.status && { status: q.status }),
      ...(q.q && { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] }),
    };
    const [rows, total] = await Promise.all([
      this.db.product.findMany({
        where,
        orderBy: parseSort(q.sort, ['createdAt', 'updatedAt', 'title', 'sortOrder'], { field: 'sortOrder', dir: 'asc' }),
        include: { variants: { select: { priceMinor: true, stock: true } }, media: { take: 1, orderBy: { position: 'asc' }, include: { mediaFile: true } } },
        ...pageArgs(q),
      }),
      this.db.product.count({ where }),
    ]);
    const items = rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      sortOrder: p.sortOrder,
      updatedAt: p.updatedAt,
      variantCount: p.variants.length,
      stock: p.variants.reduce((n, v) => n + v.stock, 0),
      priceMinor: p.variants.reduce<bigint | null>((min, v) => (min === null || v.priceMinor < min ? v.priceMinor : min), null),
      cover: p.media[0] ? this.media(p.media[0].mediaFile) : null,
    }));
    return toPage(items, total, q);
  }

  async getProduct(tenant: Tenant, id: string) {
    const p = await this.db.product.findFirst({ where: { id, organizationId: tenant.organizationId }, include: PRODUCT_INCLUDE });
    if (!p) throw new NotFoundException('Product not found');
    return this.productDto(p);
  }

  async saveProduct(req: AppRequest, tenant: Tenant, input: ProductInput, productId?: string) {
    const organizationId = tenant.organizationId;
    const id = await this.db.$transaction(async (tx) => {
      const saved = await writeProduct(tx, organizationId, input, productId);
      await this.audit.record(req, { action: productId ? 'product.updated' : 'product.created', organizationId, entityType: 'product', entityId: saved, metadata: { slug: input.slug, status: input.status } }, tx);
      return saved;
    }, TX);
    return this.getProduct(tenant, id);
  }

  async deleteProduct(req: AppRequest, tenant: Tenant, id: string) {
    const organizationId = tenant.organizationId;
    await this.db.$transaction(async (tx) => {
      // Order lines keep their snapshot (variant link becomes NULL); cart lines go away with the variants.
      const { count } = await tx.product.deleteMany({ where: { id, organizationId } });
      if (!count) throw new NotFoundException('Product not found');
      await this.audit.record(req, { action: 'product.deleted', organizationId, entityType: 'product', entityId: id }, tx);
    });
  }

  // ── collections ──

  async listCollections(tenant: Tenant) {
    const rows = await this.db.collection.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      include: { image: true, _count: { select: { products: true } } },
    });
    return rows.map(({ image, _count, ...c }) => ({ ...c, image: image ? this.media(image) : null, productCount: _count.products }));
  }

  async getCollection(tenant: Tenant, id: string) {
    const c = await this.db.collection.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: { image: true, products: { orderBy: { position: 'asc' }, select: { productId: true } } },
    });
    if (!c) throw new NotFoundException('Collection not found');
    const { image, products, ...rest } = c;
    return { ...rest, image: image ? this.media(image) : null, productIds: products.map((p) => p.productId) };
  }

  async saveCollection(req: AppRequest, tenant: Tenant, input: CollectionInput, collectionId?: string) {
    const organizationId = tenant.organizationId;
    const id = await this.db.$transaction(async (tx) => {
      const saved = await writeCollection(tx, organizationId, input, collectionId);
      await this.audit.record(req, { action: collectionId ? 'collection.updated' : 'collection.created', organizationId, entityType: 'collection', entityId: saved, metadata: { slug: input.slug } }, tx);
      return saved;
    }, TX);
    return this.getCollection(tenant, id);
  }

  async deleteCollection(req: AppRequest, tenant: Tenant, id: string) {
    const organizationId = tenant.organizationId;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.collection.deleteMany({ where: { id, organizationId } });
      if (!count) throw new NotFoundException('Collection not found');
      await this.audit.record(req, { action: 'collection.deleted', organizationId, entityType: 'collection', entityId: id }, tx);
    });
  }

  // ── size charts ──

  listSizeCharts(tenant: Tenant) {
    return this.db.sizeChart.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: 'asc' } });
  }

  async saveSizeChart(req: AppRequest, tenant: Tenant, input: SizeChartInput, id?: string) {
    const organizationId = tenant.organizationId;
    return this.db.$transaction(async (tx) => {
      let chart;
      if (id) {
        const { count } = await tx.sizeChart.updateMany({ where: { id, organizationId }, data: input });
        if (!count) throw new NotFoundException('Size chart not found');
        chart = await tx.sizeChart.findUniqueOrThrow({ where: { id } });
      } else {
        chart = await tx.sizeChart.create({ data: { ...input, organizationId } });
      }
      await this.audit.record(req, { action: id ? 'size_chart.updated' : 'size_chart.created', organizationId, entityType: 'size_chart', entityId: chart.id }, tx);
      return chart;
    });
  }

  async deleteSizeChart(req: AppRequest, tenant: Tenant, id: string) {
    const organizationId = tenant.organizationId;
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.sizeChart.deleteMany({ where: { id, organizationId } });
      if (!count) throw new NotFoundException('Size chart not found');
      await this.audit.record(req, { action: 'size_chart.deleted', organizationId, entityType: 'size_chart', entityId: id }, tx);
    });
  }

  // ── media ──

  async listMedia(tenant: Tenant, q: PaginationQuery) {
    const where = { organizationId: tenant.organizationId };
    const [rows, total] = await Promise.all([
      this.db.mediaFile.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.db.mediaFile.count({ where }),
    ]);
    return toPage(rows.map(this.media), total, q);
  }

  // ── storefront content ──

  async getContent(tenant: Tenant) {
    const organizationId = tenant.organizationId;
    const [org, sections, testimonials, playlist, lookbook] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } }),
      this.db.homeSection.findMany({ where: { organizationId } }),
      this.db.testimonial.findMany({ where: { organizationId }, orderBy: { position: 'asc' } }),
      this.db.playlistTrack.findMany({ where: { organizationId }, orderBy: { position: 'asc' } }),
      this.db.lookbook.findFirst({ where: { organizationId, slug: 'main' }, include: { items: { orderBy: { position: 'asc' } } } }),
    ]);
    // Sections never saved come back as null; the dashboard fills its own defaults.
    const bySection: Record<string, unknown> = { hero: null, featured: null, grid: null, drop: null, collections: null, social: null };
    for (const s of sections) {
      const name = SECTION_BY_TYPE[s.type];
      if (name) bySection[name] = { enabled: s.isEnabled, ...(s.config as object) };
    }
    return {
      settings: (org.settings as { storefront?: StorefrontContent['settings'] } | null)?.storefront ?? null,
      sections: bySection,
      testimonials: testimonials.map((t) => ({ author: t.author, location: t.location ?? '', quote: t.quote })),
      playlist: playlist.map((t) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, coverMediaId: t.coverFileId, audioMediaId: t.audioFileId })),
      lookbook: lookbook && {
        title: lookbook.title,
        subtitle: lookbook.subtitle ?? '',
        items: lookbook.items.map((i) => ({ mediaId: i.mediaFileId, tag: i.tag ?? '', title: i.title ?? '', caption: i.caption ?? '' })),
      },
    };
  }

  async saveContent(req: AppRequest, tenant: Tenant, doc: StorefrontContent) {
    const organizationId = tenant.organizationId;
    await this.db.$transaction(async (tx) => {
      await writeStorefrontContent(tx, organizationId, doc);
      await this.audit.record(req, { action: 'storefront.updated', organizationId, entityType: 'organization', entityId: organizationId }, tx);
    }, TX);
    return this.getContent(tenant);
  }
}
