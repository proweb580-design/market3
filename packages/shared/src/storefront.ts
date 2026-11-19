import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import type { SizeChartRow } from './sizing.js';

/*
 * Storefront contracts: the public view models the API returns to the web/Mini App storefronts,
 * and the schemas brands use to edit their catalogue and home page.
 */

// ───────────────────────── public view models ─────────────────────────

export const GARMENT_KINDS = ['puffer', 'hoodie', 'fleece', 'tee'] as const;
export type GarmentKind = (typeof GARMENT_KINDS)[number];

/** Real uploaded image, or vector demo art (demo store only; brands upload photos). */
export type Media =
  | { type: 'image'; src: string; alt: string }
  | { type: 'art'; kind: GarmentKind; view: 'front' | 'back'; alt: string };

/** Editorial photo slot (banner, lookbook, collections). */
export type Panel =
  | { type: 'image'; src: string; alt: string }
  | { type: 'art'; from: string; to: string; garment?: { kind: GarmentKind; tone: string }; alt: string };

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface ProductColor {
  name: string;
  hex: string;
}

export interface SizeChart {
  columns: string[];
  rows: (SizeChartRow & { values: string[] })[];
}

export interface StoreProduct {
  slug: string;
  title: string;
  label?: string;
  price: Money;
  gender: 'woman' | 'man' | 'unisex';
  /** Published collection slugs, in collection order. */
  collections: string[];
  colors: ProductColor[];
  sizes: { label: string; inStock: boolean }[];
  /** What can be bought: one entry per active variant. `null` = the product has no such option. */
  variants: { id: string; size: string | null; color: string | null }[];
  fabrics: string[];
  media: Media[];
  description: string[];
  sizeChart?: SizeChart;
}

export interface CollectionInfo {
  slug: string;
  title: string;
  panel: Panel;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  cover: Panel;
  src?: string;
}

export interface LookbookItem {
  id: string;
  tag: string;
  title: string;
  caption: string;
  panel: Panel;
  ratio: number;
}

export interface StoreConfig {
  slug: string;
  name: string;
  currency: string;
  freeShippingThresholdMinor: number | null;
  /** Flat shipping fee below the free-shipping threshold. */
  shippingFlatMinor: number;
  /** Home sections; null when the brand turned the section off (or the plan lacks it). */
  hero: { eyebrow: string; title: string; subtitle: string; panels: Panel[] } | null;
  featured: { title: string; subtitle: string; productSlugs: string[] } | null;
  grid: { title: string; collection: string } | null;
  drop: { eyebrow: string; title: string; endsAt: string; panel: Panel } | null;
  collections: CollectionInfo[];
  social: { handle: string; panels: Panel[] } | null;
  testimonials: { quote: string; author: string; location: string }[];
  trust: { icon: TrustIcon; title: string; text: string }[];
  /** Payment methods the brand's provider accepts, shown as text badges. */
  paymentBadges: string[];
  playlist: Track[];
  lookbook: { title: string; subtitle: string; items: LookbookItem[] } | null;
  footer: {
    menu: { label: string; path: string }[];
    help: { label: string; path: string }[];
    socials: { label: string; href: string }[];
  };
}

export interface StoreCollection {
  slug: string;
  title: string;
  products: StoreProduct[];
}

/** One response with the whole published catalogue, so a storefront page costs at most two cached API calls. */
export interface StoreCatalog {
  products: StoreProduct[];
  /** Published collections in display order; products listed by slug in collection order. */
  collections: { slug: string; title: string; productSlugs: string[] }[];
}

// ───────────────────────── editing schemas ─────────────────────────

export const catalogSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/, 'Use a-z, 0-9 and dashes (2–80 chars)');
const uuid = z.uuid();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB');
const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const money = z.number().int().min(0).max(1_000_000_000_00);
/** Same-store link, e.g. "/collections/fw26" — never another site. */
const storePath = z.string().regex(/^\/(?!\/)[a-z0-9/_-]{0,120}$/, 'Use a path inside the store, e.g. /collections/new');

export const panelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), src: httpsUrl, alt: z.string().max(200) }).strict(),
  z
    .object({
      type: z.literal('art'),
      from: hex,
      to: hex,
      garment: z.object({ kind: z.enum(GARMENT_KINDS), tone: hex }).strict().optional(),
      alt: z.string().max(200),
    })
    .strict(),
]);

const optionSchema = z
  .object({
    name: text(40),
    values: z.array(z.object({ value: text(40), swatchHex: hex.nullable().optional() }).strict()).min(1).max(50),
  })
  .strict();

const variantSchema = z
  .object({
    /** Existing variant to update (keeps its id for carts and orders); omit to create. */
    id: uuid.optional(),
    /** Option name → value, one entry per product option, e.g. {"Size":"M","Color":"Black"}. */
    options: z.record(z.string().max(40), z.string().max(40)),
    sku: text(64).nullable().optional(),
    priceMinor: money,
    compareAtPriceMinor: money.nullable().optional(),
    stock: z.number().int().min(0).max(1_000_000),
    isActive: z.boolean().default(true),
  })
  .strict();

/** Full product document: POST creates, PUT replaces (variants matched by id). */
export const productInputSchema = z
  .object({
    slug: catalogSlug,
    title: text(160),
    /** One bullet per line on the product page. */
    description: z.string().max(5000).default(''),
    label: z.string().trim().max(24).nullable().optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
    gender: z.enum(['WOMAN', 'MAN', 'UNISEX']).default('UNISEX'),
    sizeChartId: uuid.nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).default(0),
    /** "Size", "Color" and "Fabric" drive the storefront's size picker, swatches and filters. */
    options: z.array(optionSchema).max(3).default([]),
    variants: z.array(variantSchema).min(1).max(250),
    mediaIds: z.array(uuid).max(20).default([]),
    collectionIds: z.array(uuid).max(50).default([]),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
    const names = p.options.map((o) => o.name);
    if (new Set(names).size !== names.length) issue('Option names must be unique', ['options']);
    p.options.forEach((o, i) => {
      if (new Set(o.values.map((v) => v.value)).size !== o.values.length) issue('Option values must be unique', ['options', i, 'values']);
    });
    const combos = new Set<string>();
    p.variants.forEach((v, i) => {
      const keys = Object.keys(v.options);
      if (keys.length !== names.length || !names.every((n) => keys.includes(n))) {
        return issue(`Variant must set exactly these options: ${names.join(', ') || '(none)'}`, ['variants', i, 'options']);
      }
      for (const o of p.options) {
        if (!o.values.some((x) => x.value === v.options[o.name])) issue(`Unknown ${o.name} "${v.options[o.name]}"`, ['variants', i, 'options']);
      }
      const combo = names.map((n) => v.options[n]).join('\u0000');
      if (combos.has(combo)) issue('Duplicate variant', ['variants', i]);
      combos.add(combo);
    });
    if (new Set(p.mediaIds).size !== p.mediaIds.length) issue('Duplicate media', ['mediaIds']);
    if (new Set(p.collectionIds).size !== p.collectionIds.length) issue('Duplicate collection', ['collectionIds']);
    const skus = p.variants.map((v) => v.sku).filter(Boolean);
    if (new Set(skus).size !== skus.length) issue('Duplicate SKU', ['variants']);
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const productListQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(), q: z.string().trim().max(100).optional() })
  .strict();

export const collectionInputSchema = z
  .object({
    slug: catalogSlug,
    title: text(80),
    description: z.string().max(2000).nullable().optional(),
    imageId: uuid.nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).default(0),
    isPublished: z.boolean().default(true),
    /** Products in display order. */
    productIds: z.array(uuid).max(1000).default([]),
  })
  .strict()
  .refine((c) => new Set(c.productIds).size === c.productIds.length, { message: 'Duplicate product', path: ['productIds'] });
export type CollectionInput = z.infer<typeof collectionInputSchema>;

export const sizeChartInputSchema = z
  .object({
    name: text(80),
    columns: z.array(text(24)).min(1).max(8),
    rows: z
      .array(z.object({ size: text(12), chestCm: z.number().min(20).max(120), values: z.array(z.string().trim().max(24)) }).strict())
      .min(1)
      .max(20),
  })
  .strict()
  .refine((c) => c.rows.every((r) => r.values.length === c.columns.length), { message: 'Each row needs one value per column', path: ['rows'] });
export type SizeChartInput = z.infer<typeof sizeChartInputSchema>;

export const TRUST_ICONS = ['truck', 'shield', 'returns', 'globe'] as const;
export type TrustIcon = (typeof TRUST_ICONS)[number];

const link = z.object({ label: text(40), path: storePath }).strict();
const section = <T extends z.ZodRawShape>(shape: T) => z.object({ enabled: z.boolean(), ...shape }).strict();

/** Everything on the storefront that is not the catalogue. PUT replaces it as one document. */
export const storefrontContentSchema = z
  .object({
    settings: z
      .object({
        freeShippingThresholdMinor: money.nullable(),
        /** Flat shipping fee charged below the threshold (0 = always free). */
        shippingFlatMinor: money.default(0),
        trust: z.array(z.object({ icon: z.enum(TRUST_ICONS), title: text(40), text: text(120) }).strict()).max(4),
        paymentBadges: z.array(text(24)).max(8),
        footer: z
          .object({
            menu: z.array(link).max(10),
            help: z.array(link).max(10),
            socials: z.array(z.object({ label: text(24), href: httpsUrl }).strict()).max(8),
          })
          .strict(),
      })
      .strict(),
    sections: z
      .object({
        hero: section({ eyebrow: z.string().max(60), title: text(40), subtitle: z.string().max(120), panels: z.array(panelSchema).min(1).max(5) }),
        featured: section({ title: text(40), subtitle: z.string().max(120), productSlugs: z.array(catalogSlug).max(12) }),
        grid: section({ title: text(40), collection: catalogSlug }),
        drop: section({ eyebrow: z.string().max(60), title: text(80), endsAt: z.iso.datetime(), panel: panelSchema }),
        collections: section({ slugs: z.array(catalogSlug).max(8) }),
        social: section({ handle: z.string().max(40), panels: z.array(panelSchema).max(10) }),
      })
      .strict(),
    testimonials: z.array(z.object({ author: text(60), location: z.string().trim().max(60), quote: text(400) }).strict()).max(20),
    /** Music player (plan feature `music_player`). Media must be this store's uploads. */
    playlist: z
      .array(
        z
          .object({ title: text(80), artist: text(80), durationSec: z.number().int().min(1).max(3600), coverMediaId: uuid.nullable(), audioMediaId: uuid.nullable() })
          .strict(),
      )
      .max(30),
    /** Lookbook page (plan feature `lookbook`); null removes it. */
    lookbook: z
      .object({
        title: text(80),
        subtitle: z.string().max(160),
        items: z.array(z.object({ mediaId: uuid, tag: z.string().max(24), title: z.string().max(80), caption: z.string().max(160) }).strict()).max(60),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type StorefrontContent = z.infer<typeof storefrontContentSchema>;
