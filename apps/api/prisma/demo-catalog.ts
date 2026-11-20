/**
 * DEVELOPMENT ONLY: catalogue and home page of the fictional "ashen" demo store (demo photos; vector art only for playlist covers).
 * Written through the same functions the API uses, so the demo exercises the real storage path.
 */
import type { GarmentKind, ProductInput, SizeChartInput, StorefrontContent } from '@repo/shared';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { writeCollection, writeProduct, writeStorefrontContent } from '../src/modules/catalog/catalog-writer.js';
import { ART_MIME } from '../src/modules/catalog/view.js';

const outerwearChart: SizeChartInput = {
  name: 'Outerwear',
  columns: ['Chest', 'Length', 'Sleeve'],
  rows: [
    { size: 'XS', chestCm: 51, values: ['51 cm', '66 cm', '60 cm'] },
    { size: 'S', chestCm: 54, values: ['54 cm', '68 cm', '62 cm'] },
    { size: 'M', chestCm: 57, values: ['57 cm', '70 cm', '64 cm'] },
    { size: 'L', chestCm: 60, values: ['60 cm', '72 cm', '66 cm'] },
    { size: 'XL', chestCm: 63, values: ['63 cm', '74 cm', '68 cm'] },
    { size: '2XL', chestCm: 66, values: ['66 cm', '76 cm', '70 cm'] },
  ],
};

const teeChart: SizeChartInput = {
  name: 'Tees',
  columns: ['Chest', 'Length', 'Shoulder'],
  rows: [
    { size: 'XS', chestCm: 52, values: ['52 cm', '67 cm', '52 cm'] },
    { size: 'S', chestCm: 55, values: ['55 cm', '69 cm', '54 cm'] },
    { size: 'M', chestCm: 58, values: ['58 cm', '71 cm', '56 cm'] },
    { size: 'L', chestCm: 61, values: ['61 cm', '73 cm', '58 cm'] },
    { size: 'XL', chestCm: 64, values: ['64 cm', '75 cm', '60 cm'] },
  ],
};

/** Demo photos (background cut out, transparent WebP) shipped in apps/web/public/demo and apps/mini-app/public/demo. One photo per product. */
const PHOTOS = {
  'puffer-black.webp': { alt: 'Black down puffer jacket', width: 888, height: 981 },
  'puffer-gloss.webp': { alt: 'Black ripstop puffer jacket', width: 709, height: 739 },
  'puffer-shine.webp': { alt: 'Glossy black puffer jacket', width: 1064, height: 1293 },
  'puffer-pink-hood.webp': { alt: 'Glossy black puffer with pink-lined hood', width: 916, height: 1045 },
  'puffer-fur.webp': { alt: 'Glossy black puffer with fur-trimmed hood', width: 712, height: 772 },
  'track-jacket.webp': { alt: 'Brown track jacket', width: 709, height: 608 },
  'hoodie.webp': { alt: 'Washed two-tone hoodie', width: 735, height: 912 },
  'tee-black.webp': { alt: 'Black tee with white piping', width: 620, height: 638 },
} as const;
type Photo = keyof typeof PHOTOS;

type DemoProduct = { slug: string; title: string; kind: GarmentKind; color: { name: string; hex: string }; price: number; gender?: ProductInput['gender']; photo: Photo };

const products: DemoProduct[] = [
  { slug: 'quilt-puffer-black', title: 'Quilt Puffer (Black)', kind: 'puffer', color: { name: 'Black', hex: '#141414' }, price: 300, photo: 'puffer-black.webp' },
  { slug: 'storm-fleece-ash', title: 'Storm Fleece (Ash Black)', kind: 'fleece', color: { name: 'Ash', hex: '#2b2b2d' }, price: 150, gender: 'MAN', photo: 'track-jacket.webp' },
  { slug: 'heat-shell-graphite', title: 'Heat Shell (Graphite)', kind: 'puffer', color: { name: 'Graphite', hex: '#3a3c40' }, price: 280, photo: 'puffer-gloss.webp' },
  { slug: 'drift-puffer-navy', title: 'Drift Puffer (Navy)', kind: 'puffer', color: { name: 'Navy', hex: '#1c2740' }, price: 320, gender: 'MAN', photo: 'puffer-shine.webp' },
  { slug: 'night-hoodie-black', title: 'Night Hoodie (Black)', kind: 'hoodie', color: { name: 'Black', hex: '#161616' }, price: 140, photo: 'hoodie.webp' },
  { slug: 'signal-tee-black', title: 'Signal Tee (Black)', kind: 'tee', color: { name: 'Black', hex: '#151515' }, price: 60, photo: 'tee-black.webp' },
  { slug: 'quilt-puffer-stone', title: 'Quilt Puffer (Stone)', kind: 'puffer', color: { name: 'Stone', hex: '#8f8a83' }, price: 300, gender: 'WOMAN', photo: 'puffer-pink-hood.webp' },
  { slug: 'frost-parka-black', title: 'Frost Parka (Black)', kind: 'puffer', color: { name: 'Black', hex: '#121212' }, price: 380, photo: 'puffer-fur.webp' },
];
/** Earlier demo products that had no photo of their own: archived on re-seed (not deleted, orders may point at them). */
const RETIRED = ['storm-fleece-fog', 'cloud-hoodie-ice', 'signal-tee-bone', 'static-tee-grey', 'mono-tee-black'];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const TEE_TEXT = ['Heavyweight 280 gsm cotton', 'Boxy fit, dropped shoulder', 'Puff-print graphic', 'Pre-shrunk'];
const OUTER_TEXT = ['Regular fit', 'Water-repellent shell', 'Two-way zip with storm flap', 'Adjustable hood and hem', 'Embroidered chest logo'];

const art = (from: string, to: string) => ({ from, to });
const shot = (file: Photo) => ({ type: 'image' as const, src: `/demo/${file}`, alt: 'Campaign photo' });

const collections: { slug: string; title: string; photo: Photo; has: (p: DemoProduct) => boolean }[] = [
  { slug: 'fw26', title: 'FW26', photo: 'puffer-black.webp', has: () => true },
  { slug: 'outerwear', title: 'Outerwear', photo: 'track-jacket.webp', has: (p) => p.kind !== 'tee' },
  { slug: 'tops', title: 'Tops', photo: 'tee-black.webp', has: (p) => p.kind === 'tee' },
  { slug: 'essentials', title: 'Essentials', photo: 'hoodie.webp', has: (p) => p.kind === 'hoodie' || p.kind === 'tee' },
];

const lookbook: { tag: string; title: string; caption: string; photo: Photo }[] = [
  { tag: 'FW26', title: 'Platform 4', caption: 'Quilt Puffer', photo: 'puffer-black.webp' },
  { tag: 'Campaign', title: 'Underpass', caption: 'Night Hoodie', photo: 'hoodie.webp' },
  { tag: 'FW26', title: 'Last train', caption: 'Signal Tee', photo: 'tee-black.webp' },
  { tag: 'Editorial', title: 'Concrete', caption: 'Heat Shell', photo: 'puffer-gloss.webp' },
  { tag: 'Campaign', title: 'Stairwell', caption: 'Storm Fleece', photo: 'track-jacket.webp' },
  { tag: 'Editorial', title: 'Blue hour', caption: 'Drift Puffer', photo: 'puffer-shine.webp' },
  { tag: 'SS25', title: 'Courtyard', caption: 'Frost Parka', photo: 'puffer-fur.webp' },
  { tag: 'FW26', title: 'Exit 9', caption: 'Quilt Puffer (Stone)', photo: 'puffer-pink-hood.webp' },
];

const tracks = [
  { title: 'Low Lights', artist: 'Ashen Radio', durationSec: 184, art: art('#2c3a2e', '#0d120e') },
  { title: 'Night Shift', artist: 'Ashen Radio', durationSec: 201, art: art('#3b2c3a', '#120d12') },
  { title: 'Cold Front', artist: 'Ashen Radio', durationSec: 167, art: art('#2a3442', '#0b0f15') },
];

export async function seedDemoCatalog(db: PrismaClient, organizationId: string) {
  /** Art "media file" (playlist covers) keyed by name, so re-running the seed updates instead of duplicating. */
  const media = async (name: string, meta: object, alt: string) => {
    const storageKey = `demo/${organizationId}/${name}`;
    const data = { mimeType: ART_MIME, sizeBytes: 0n, meta, alt, width: null, height: null };
    return (await db.mediaFile.upsert({ where: { storageKey }, update: data, create: { organizationId, storageKey, ...data } })).id;
  };
  /** One media row per demo photo, shared by everything that shows it. Keys starting with "/" are served by the site itself. */
  const photo = async (file: Photo) => {
    const storageKey = `/demo/${file}`;
    const data = { mimeType: 'image/webp', sizeBytes: 0n, meta: {}, ...PHOTOS[file] };
    return (await db.mediaFile.upsert({ where: { storageKey }, update: data, create: { organizationId, storageKey, ...data } })).id;
  };

  const chartId = async (chart: SizeChartInput) => {
    const found = await db.sizeChart.findFirst({ where: { organizationId, name: chart.name } });
    return (found ? await db.sizeChart.update({ where: { id: found.id }, data: chart }) : await db.sizeChart.create({ data: { organizationId, ...chart } })).id;
  };
  const charts = { outer: await chartId(outerwearChart), tee: await chartId(teeChart) };

  const productIds: Record<string, string> = {};
  for (const [i, p] of products.entries()) {
    const isTee = p.kind === 'tee';
    const sizes = isTee ? SIZES.slice(0, 5) : SIZES;
    const fabric = isTee ? 'Cotton' : p.kind === 'puffer' ? 'Nylon' : 'Fleece';
    const input: ProductInput = {
      slug: p.slug,
      title: p.title,
      label: 'FW26',
      description: (isTee ? TEE_TEXT : OUTER_TEXT).join('\n'),
      status: 'ACTIVE',
      gender: p.gender ?? 'UNISEX',
      sizeChartId: isTee ? charts.tee : charts.outer,
      sortOrder: i,
      options: [
        { name: 'Size', values: sizes.map((value) => ({ value })) },
        { name: 'Color', values: [{ value: p.color.name, swatchHex: p.color.hex }] },
        { name: 'Fabric', values: [{ value: fabric }] },
      ],
      variants: sizes.map((size, s) => ({
        options: { Size: size, Color: p.color.name, Fabric: fabric },
        sku: `${p.slug}-${size}`.toUpperCase(),
        priceMinor: p.price * 100,
        stock: (p.slug.length + s) % 5 === 0 ? 0 : 12,
        isActive: true,
      })),
      mediaIds: [await photo(p.photo)],
      collectionIds: [],
    };
    const existing = await db.product.findFirst({ where: { organizationId, slug: p.slug }, select: { id: true } });
    productIds[p.slug] = await db.$transaction((tx) => writeProduct(tx, organizationId, input, existing?.id), { timeout: 20_000 });
  }
  await db.product.updateMany({ where: { organizationId, slug: { in: RETIRED } }, data: { status: 'ARCHIVED' } });

  for (const [i, c] of collections.entries()) {
    const existing = await db.collection.findFirst({ where: { organizationId, slug: c.slug }, select: { id: true } });
    const input = {
      slug: c.slug,
      title: c.title,
      imageId: await photo(c.photo),
      sortOrder: i,
      isPublished: true,
      productIds: products.filter(c.has).map((p) => productIds[p.slug]!),
    };
    await db.$transaction((tx) => writeCollection(tx, organizationId, input, existing?.id));
  }

  const content: StorefrontContent = {
    settings: {
      freeShippingThresholdMinor: 15000,
      shippingFlatMinor: 1000,
      trust: [
        { icon: 'truck', title: 'Free shipping', text: 'On orders over $150' },
        { icon: 'shield', title: 'Secure payment', text: 'Encrypted checkout — shop with confidence' },
        { icon: 'returns', title: 'Easy returns', text: 'Hassle-free returns within 30 days' },
        { icon: 'globe', title: 'Worldwide shipping', text: 'Delivered to your door, wherever you are' },
      ],
      paymentBadges: ['Visa', 'Mastercard', 'Apple Pay', 'Google Pay'],
      footer: {
        menu: [
          { label: 'Shop all', path: '/collections/fw26' },
          { label: 'Outerwear', path: '/collections/outerwear' },
          { label: 'Tops', path: '/collections/tops' },
          { label: 'Lookbook', path: '/lookbook' },
        ],
        help: [
          { label: 'Shipping', path: '/pages/shipping' },
          { label: 'Returns', path: '/pages/returns' },
          { label: 'Terms', path: '/pages/terms' },
          { label: 'Privacy', path: '/pages/privacy' },
        ],
        socials: [
          { label: 'Instagram', href: 'https://instagram.com' },
          { label: 'TikTok', href: 'https://tiktok.com' },
          { label: 'Telegram', href: 'https://t.me' },
        ],
      },
    },
    sections: {
      hero: {
        enabled: true,
        eyebrow: 'Outerwear drop 01',
        title: 'FW26',
        subtitle: 'Built for those who move at night',
        panels: [shot('track-jacket.webp'), shot('puffer-black.webp'), shot('hoodie.webp')],
      },
      featured: {
        enabled: true,
        title: 'Featured',
        subtitle: 'Picked for the season',
        productSlugs: ['quilt-puffer-black', 'storm-fleece-ash', 'drift-puffer-navy', 'signal-tee-black', 'heat-shell-graphite', 'frost-parka-black'],
      },
      grid: { enabled: true, title: 'New in', collection: 'fw26' },
      drop: { enabled: true, eyebrow: 'Next drop', title: 'The Midnight Collection', endsAt: '2026-12-12T18:00:00Z', panel: shot('puffer-fur.webp') },
      collections: { enabled: true, slugs: collections.map((c) => c.slug) },
      social: {
        enabled: true,
        handle: '@ashen.studio',
        panels: [
          shot('hoodie.webp'),
          shot('tee-black.webp'),
          shot('puffer-shine.webp'),
          shot('track-jacket.webp'),
          shot('puffer-pink-hood.webp'),
        ],
      },
    },
    testimonials: [
      { quote: 'Fits exactly like the size finder said. Warmest jacket I own.', author: 'Mila R.', location: 'Berlin' },
      { quote: 'Shipping took three days and the quality is unreal for the price.', author: 'Daniel K.', location: 'Warsaw' },
      { quote: 'The fleece is heavy in the best way. Already ordered a second colour.', author: 'Aisha T.', location: 'London' },
    ],
    playlist: await Promise.all(
      tracks.map(async (t, i) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, coverMediaId: await media(`tracks/${i}`, t.art, t.title), audioMediaId: null })),
    ),
    lookbook: {
      title: 'Ashen gallery',
      subtitle: 'A visual study of the latest collection',
      items: await Promise.all(
        lookbook.map(async (l, i) => ({ mediaId: await photo(l.photo), tag: l.tag, title: l.title, caption: l.caption })),
      ),
    },
  };
  await db.$transaction((tx) => writeStorefrontContent(tx, organizationId, content));
  return { products: products.length, collections: collections.length };
}
