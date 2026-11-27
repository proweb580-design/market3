import { Inject, Injectable } from '@nestjs/common';
import type { CollectionInfo, Panel, StoreCatalog, StoreConfig, StorefrontContent } from '@repo/shared';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { SECTION_BY_TYPE, type SectionName } from './catalog-writer.js';
import { ART_MIME, mediaUrl, toPanel, toStoreProduct } from './view.js';

type Sections = StorefrontContent['sections'];

const DEFAULT_SETTINGS: StorefrontContent['settings'] = {
  freeShippingThresholdMinor: null,
  shippingFlatMinor: 0,
  trust: [],
  paymentBadges: [],
  footer: { menu: [], help: [], socials: [] },
};

/**
 * Public, read-only storefront data by store slug. Only ACTIVE stores, ACTIVE products and published
 * collections/content are visible; plan-gated sections disappear when the plan lacks the feature.
 * Nothing private (ids, stock numbers, drafts, costs) leaves this service.
 */
@Injectable()
export class StorefrontService {
  constructor(
    private readonly db: PrismaService,
    private readonly entitlements: EntitlementsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private url = (key: string) => mediaUrl(this.env.SUPABASE_URL, key);

  private findStore(slug: string) {
    return this.db.organization.findFirst({ where: { slug, status: 'ACTIVE', deletedAt: null } });
  }

  async store(slug: string): Promise<StoreConfig | null> {
    const org = await this.findStore(slug);
    if (!org) return null;
    const organizationId = org.id;
    // One parallel batch: collection tiles are read with everything else and picked by slug below,
    // rather than in a second round trip once the sections are known.
    const [ent, sectionRows, testimonials, tracks, lookbook, published, bot] = await Promise.all([
      this.entitlements.forOrganization(organizationId),
      this.db.homeSection.findMany({ where: { organizationId, isEnabled: true } }),
      this.db.testimonial.findMany({ where: { organizationId, isPublished: true }, orderBy: { position: 'asc' } }),
      this.db.playlistTrack.findMany({ where: { organizationId, isPublished: true }, orderBy: { position: 'asc' }, include: { coverFile: true, audioFile: true } }),
      this.db.lookbook.findFirst({ where: { organizationId, slug: 'main', isPublished: true }, include: { items: { orderBy: { position: 'asc' }, include: { mediaFile: true } } } }),
      this.db.collection.findMany({ where: { organizationId, isPublished: true }, include: { image: true } }),
      this.db.integration.findFirst({ where: { organizationId, kind: 'TELEGRAM_BOT', provider: 'telegram', status: 'ACTIVE' }, select: { publicConfig: true } }),
    ]);
    const has = (feature: string) => ent.features[feature]?.enabled === true;

    const sections: Partial<{ [K in SectionName]: Omit<Sections[K], 'enabled'> }> = {};
    for (const s of sectionRows) {
      const name = SECTION_BY_TYPE[s.type];
      if (name) (sections as Record<string, unknown>)[name] = s.config;
    }

    const tileSlugs = sections.collections?.slugs ?? [];
    const collections: CollectionInfo[] = tileSlugs.flatMap((s) => {
      const c = published.find((t) => t.slug === s);
      return c ? [{ slug: c.slug, title: c.title, panel: toPanel(c.image, this.url) }] : [];
    });

    const settings = (org.settings as { storefront?: StorefrontContent['settings'] } | null)?.storefront ?? DEFAULT_SETTINGS;
    return {
      slug: org.slug,
      name: org.name,
      currency: org.currency,
      freeShippingThresholdMinor: settings.freeShippingThresholdMinor,
      shippingFlatMinor: settings.shippingFlatMinor ?? 0,
      hero: sections.hero ? { ...sections.hero, panels: sections.hero.panels as Panel[] } : null,
      featured: sections.featured ?? null,
      grid: sections.grid ?? null,
      drop: sections.drop && has('drop_countdown') ? { ...sections.drop, panel: sections.drop.panel as Panel } : null,
      collections,
      social: sections.social ? { ...sections.social, panels: sections.social.panels as Panel[] } : null,
      testimonials: testimonials.map((t) => ({ quote: t.quote, author: t.author, location: t.location ?? '' })),
      trust: settings.trust,
      paymentBadges: settings.paymentBadges,
      playlist: has('music_player')
        ? tracks.map((t) => ({
            id: t.id,
            title: t.title,
            artist: t.artist,
            durationSec: t.durationSec,
            cover: toPanel(t.coverFile, this.url),
            ...(t.audioFile && t.audioFile.mimeType !== ART_MIME && { src: this.url(t.audioFile.storageKey) }),
          }))
        : [],
      lookbook:
        lookbook && has('lookbook')
          ? {
              title: lookbook.title,
              subtitle: lookbook.subtitle ?? '',
              items: lookbook.items.map((i) => ({
                id: i.id,
                tag: i.tag ?? '',
                title: i.title ?? '',
                caption: i.caption ?? '',
                panel: toPanel(i.mediaFile, this.url),
                ratio: i.mediaFile.width && i.mediaFile.height ? Math.round((i.mediaFile.height / i.mediaFile.width) * 100) / 100 : 1.3,
              })),
            }
          : null,
      telegramBot: (bot?.publicConfig as { username?: string } | null)?.username ?? null,
      footer: settings.footer,
    };
  }

  async catalog(slug: string): Promise<StoreCatalog | null> {
    const org = await this.findStore(slug);
    if (!org) return null;
    const organizationId = org.id;
    const [products, collections] = await Promise.all([
      this.db.product.findMany({
        where: { organizationId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          options: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
          variants: { orderBy: { position: 'asc' }, include: { optionValues: { select: { optionValueId: true } } } },
          media: { orderBy: { position: 'asc' }, include: { mediaFile: true } },
          sizeChart: true,
        },
      }),
      this.db.collection.findMany({
        where: { organizationId, isPublished: true },
        orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
        include: { products: { where: { product: { status: 'ACTIVE' } }, orderBy: { position: 'asc' }, select: { product: { select: { slug: true } } } } },
      }),
    ]);
    const lists = collections.map((c) => ({ slug: c.slug, title: c.title, productSlugs: c.products.map((p) => p.product.slug) }));
    return {
      // shortcut: the whole published catalogue in one response (bounded by the plan's products.max); paginate if plans grow past a few thousand.
      products: products.map((p) =>
        toStoreProduct(
          p,
          org.currency,
          lists.filter((c) => c.productSlugs.includes(p.slug)).map((c) => c.slug),
          this.url,
        ),
      ),
      collections: lists,
    };
  }
}
