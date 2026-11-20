/**
 * DEVELOPMENT ONLY: catalogue and home page of the fictional "ashen" demo store (demo photos; vector art where there is no photo).
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

/** Demo photos (background cut out, transparent WebP) shipped in apps/web/public/demo and apps/mini-app/public/demo. Tees have no photo yet, so they keep vector art. */
const PHOTOS = {
  'puffer-black.webp': { alt: 'Black down puffer jacket', width: 888, height: 981 },
  'puffer-gloss.webp': { alt: 'Glossy black puffer jacket', width: 709, height: 739 },
  'track-jacket.webp': { alt: 'Brown track jacket', width: 709, height: 608 },
  'hoodie.webp': { alt: 'Washed two-tone hoodie', width: 735, height: 912 },
} as const;
type Photo = keyof typeof PHOTOS;
const KIND_PHOTO: Partial<Record<GarmentKind, Photo>> = { puffer: 'puffer-black.webp', fleece: 'track-jacket.webp', hoodie: 'hoodie.webp' };

type DemoProduct = { slug: string; title: string; kind: GarmentKind; color: { name: string; hex: string }; price: number; gender?: ProductInput['gender']; photo?: Photo };

const products: DemoProduct[] = [
  { slug: 'quilt-puffer-black', title: 'Quilt Puffer (Black)', kind: 'puffer', color: { name: 'Black', hex: '#141414' }, price: 300 },
  { slug: 'storm-fleece-ash', title: 'Storm Fleece (Ash Black)', kind: 'fleece', color: { name: 'Ash', hex: '#2b2b2d' }, price: 150, gender: 'MAN' },
  { slug: 'storm-fleece-fog', title: 'Storm Fleece (Fog Grey)', kind: 'fleece', color: { name: 'Fog', hex: '#b9b7b3' }, price: 150, gender: 'WOMAN' },
  { slug: 'heat-shell-graphite', title: 'Heat Shell (Graphite)', kind: 'puffer', color: { name: 'Graphite', hex: '#3a3c40' }, price: 280, photo: 'puffer-gloss.webp' },
  { slug: 'drift-puffer-navy', title: 'Drift Puffer (Navy)', kind: 'puffer', color: { name: 'Navy', hex: '#1c2740' }, price: 320, gender: 'MAN', photo: 'puffer-gloss.webp' },
  { slug: 'night-hoodie-black', title: 'Night Hoodie (Black)', kind: 'hoodie', color: { name: 'Black', hex: '#161616' }, price: 140 },
  { slug: 'cloud-hoodie-ice', title: 'Cloud Hoodie (Ice)', kind: 'hoodie', color: { name: 'Ice', hex: '#d9dcdf' }, price: 140, gender: 'WOMAN' },
  { slug: 'signal-tee-black', title: 'Signal Tee (Black)', kind: 'tee', color: { name: 'Black', hex: '#151515' }, price: 60 },
  { slug: 'signal-tee-bone', title: 'Signal Tee (Bone)', kind: 'tee', color: { name: 'Bone', hex: '#e8e4dc' }, price: 60, gender: 'WOMAN' },
  { slug: 'static-tee-grey', title: 'Static Tee (Grey)', kind: 'tee', color: { name: 'Grey', hex: '#9a9a9a' }, price: 55 },
  { slug: 'mono-tee-black', title: 'Mono Tee (Black)', kind: 'tee', color: { name: 'Black', hex: '#101010' }, price: 50, gender: 'MAN' },
  { slug: 'quilt-puffer-stone', title: 'Quilt Puffer (Stone)', kind: 'puffer', color: { name: 'Stone', hex: '#8f8a83' }, price: 300, gender: 'WOMAN' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const TEE_TEXT = ['Heavyweight 280 gsm cotton', 'Boxy fit, dropped shoulder', 'Puff-print graphic', 'Pre-shrunk'];
const OUTER_TEXT = ['Regular fit', 'Water-repellent shell', 'Two-way zip with storm flap', 'Adjustable hood and hem', 'Embroidered chest logo'];

const art = (from: string, to: string, kind?: GarmentKind, tone?: string) => ({ from, to, ...(kind && tone && { garment: { kind, tone } }) });
const inline = (from: string, to: string, kind?: GarmentKind, tone?: string) => {
  const photo = kind && KIND_PHOTO[kind];
  return photo ? { type: 'image' as const, src: `/demo/${photo}`, alt: 'Campaign photo' } : { type: 'art' as const, ...art(from, to, kind, tone), alt: 'Campaign photo' };
};

const collections = [
  { slug: 'fw26', title: 'FW26', panel: art('#3b3f46', '#16181b', 'puffer', '#1d1f22'), has: () => true },
  { slug: 'outerwear', title: 'Outerwear', panel: art('#4d5866', '#1a1f26', 'fleece', '#c9c8c4'), has: (p: DemoProduct) => p.kind !== 'tee' },
  { slug: 'tops', title: 'Tops', panel: art('#6b6660', '#2a2725', 'tee', '#151515'), has: (p: DemoProduct) => p.kind === 'tee' },
  { slug: 'essentials', title: 'Essentials', panel: art('#25303d', '#0d1116', 'hoodie', '#e1e3e5'), has: (p: DemoProduct) => p.kind === 'hoodie' || p.kind === 'tee' },
];

const lookbook = [
  { tag: 'FW26', title: 'Platform 4', caption: 'Quilt Puffer, Storm Fleece', ratio: 1.3, art: art('#444a52', '#15171a', 'puffer', '#151515') },
  { tag: 'Campaign', title: 'Underpass', caption: 'Cloud Hoodie', ratio: 1.55, art: art('#6e6a66', '#262422', 'hoodie', '#dadcdf') },
  { tag: 'FW26', title: 'Last train', caption: 'Signal Tee, Drift Puffer', ratio: 1.15, art: art('#33435a', '#10151d', 'tee', '#141414') },
  { tag: 'Editorial', title: 'Concrete', caption: 'Heat Shell', ratio: 1.45, art: art('#55585c', '#1b1c1e', 'puffer', '#3a3c40') },
  { tag: 'SS25', title: 'Roofline', caption: 'Static Tee', ratio: 1.1, art: art('#7a7f86', '#2b2e33', 'tee', '#9a9a9a') },
  { tag: 'Campaign', title: 'Stairwell', caption: 'Night Hoodie', ratio: 1.4, art: art('#2e2a33', '#0e0d10', 'hoodie', '#161616') },
  { tag: 'Editorial', title: 'Blue hour', caption: 'Drift Puffer', ratio: 1.25, art: art('#1d3768', '#0a1326', 'puffer', '#1c2740') },
  { tag: 'SS25', title: 'Courtyard', caption: 'Signal Tee (Bone)', ratio: 1.5, art: art('#8a857d', '#35322e', 'tee', '#e8e4dc') },
  { tag: 'FW26', title: 'Exit 9', caption: 'Storm Fleece (Fog)', ratio: 1.2, art: art('#4c4f53', '#18191b', 'fleece', '#b9b7b3') },
];

const tracks = [
  { title: 'Low Lights', artist: 'Ashen Radio', durationSec: 184, art: art('#2c3a2e', '#0d120e') },
  { title: 'Night Shift', artist: 'Ashen Radio', durationSec: 201, art: art('#3b2c3a', '#120d12') },
  { title: 'Cold Front', artist: 'Ashen Radio', durationSec: 167, art: art('#2a3442', '#0b0f15') },
];

export async function seedDemoCatalog(db: PrismaClient, organizationId: string) {
  /** Art "media file" keyed by name, so re-running the seed updates instead of duplicating. */
  const media = async (name: string, meta: object, alt: string, ratio?: number) => {
    const storageKey = `demo/${organizationId}/${name}`;
    const data = { mimeType: ART_MIME, sizeBytes: 0n, meta, alt, width: ratio ? 1000 : null, height: ratio ? Math.round(ratio * 1000) : null };
    return (await db.mediaFile.upsert({ where: { storageKey }, update: data, create: { organizationId, storageKey, ...data } })).id;
  };
  /** One media row per demo photo, shared by everything that shows it. Keys starting with "/" are served by the site itself. */
  const photo = async (file: Photo) => {
    const storageKey = `/demo/${file}`;
    const data = { mimeType: 'image/webp', sizeBytes: 0n, meta: {}, ...PHOTOS[file] };
    return (await db.mediaFile.upsert({ where: { storageKey }, update: data, create: { organizationId, storageKey, ...data } })).id;
  };
  /** Collection / lookbook panel: the photo of its garment if there is one, else the vector art. */
  const panel = (name: string, a: ReturnType<typeof art>, alt: string, ratio?: number) => {
    const kind = (a as { garment?: { kind: GarmentKind } }).garment?.kind;
    const file = kind && KIND_PHOTO[kind];
    return file ? photo(file) : media(name, a, alt, ratio);
  };

  const chartId = async (chart: SizeChartInput) => {
    const found = await db.sizeChart.findFirst({ where: { organizationId, name: chart.name } });
    return (found ? await db.sizeChart.update({ where: { id: found.id }, data: chart }) : await db.sizeChart.create({ data: { organizationId, ...chart } })).id;
  };
  const charts = { outer: await chartId(outerwearChart), tee: await chartId(teeChart) };

  const productIds: Record<string, string> = {};
  for (const [i, p] of products.entries()) {
    const isTee = p.kind === 'tee';
    const productPhoto = p.photo ?? KIND_PHOTO[p.kind];
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
      mediaIds: productPhoto
        ? [await photo(productPhoto)]
        : [
            await media(`products/${p.slug}-front`, { kind: p.kind, view: 'front' }, `${p.title} — front`),
            await media(`products/${p.slug}-back`, { kind: p.kind, view: 'back' }, `${p.title} — back`),
          ],
      collectionIds: [],
    };
    const existing = await db.product.findFirst({ where: { organizationId, slug: p.slug }, select: { id: true } });
    productIds[p.slug] = await db.$transaction((tx) => writeProduct(tx, organizationId, input, existing?.id), { timeout: 20_000 });
  }

  for (const [i, c] of collections.entries()) {
    const existing = await db.collection.findFirst({ where: { organizationId, slug: c.slug }, select: { id: true } });
    const input = {
      slug: c.slug,
      title: c.title,
      imageId: await panel(`collections/${c.slug}`, c.panel, c.title),
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
        panels: [inline('#20242b', '#07090c', 'fleece', '#30343a'), inline('#1b3a6b', '#0a1424', 'puffer', '#21457f'), inline('#5b5d60', '#232426', 'hoodie', '#b8babd')],
      },
      featured: {
        enabled: true,
        title: 'Featured',
        subtitle: 'Picked for the season',
        productSlugs: ['quilt-puffer-black', 'storm-fleece-fog', 'drift-puffer-navy', 'signal-tee-black', 'heat-shell-graphite', 'cloud-hoodie-ice'],
      },
      grid: { enabled: true, title: 'New in', collection: 'fw26' },
      drop: { enabled: true, eyebrow: 'Next drop', title: 'The Midnight Collection', endsAt: '2026-12-12T18:00:00Z', panel: inline('#3a1f22', '#0b0b0d', 'puffer', '#5a2a2e') },
      collections: { enabled: true, slugs: collections.map((c) => c.slug) },
      social: {
        enabled: true,
        handle: '@ashen.studio',
        panels: [
          inline('#8d9097', '#3d4046', 'hoodie', '#e6e6e6'),
          inline('#3c2b33', '#111014', 'tee', '#121212'),
          inline('#1f3f78', '#0b1730', 'puffer', '#2552a0'),
          inline('#2a2d31', '#0c0d0f', 'fleece', '#3a3d42'),
          inline('#44546a', '#151b24', 'puffer', '#22314a'),
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
        lookbook.map(async (l, i) => ({ mediaId: await panel(`lookbook/${i}`, l.art, l.title, l.ratio), tag: l.tag, title: l.title, caption: l.caption })),
      ),
    },
  };
  await db.$transaction((tx) => writeStorefrontContent(tx, organizationId, content));
  return { products: products.length, collections: collections.length };
}
