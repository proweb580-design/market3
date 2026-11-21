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
  columns: ['Грудь', 'Длина', 'Рукав'],
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
  columns: ['Грудь', 'Длина', 'Плечо'],
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
  'puffer-black.webp': { alt: 'Чёрный пуховик', width: 886, height: 979 },
  'puffer-gloss.webp': { alt: 'Чёрный пуховик из рипстопа', width: 707, height: 737 },
  'puffer-shine.webp': { alt: 'Глянцевый чёрный пуховик', width: 1052, height: 1288 },
  'puffer-pink-hood.webp': { alt: 'Глянцевый чёрный пуховик с розовой подкладкой капюшона', width: 907, height: 1038 },
  'puffer-fur.webp': { alt: 'Глянцевый чёрный пуховик с меховой опушкой', width: 710, height: 770 },
  'track-jacket.webp': { alt: 'Коричневая олимпийка', width: 705, height: 605 },
  'hoodie.webp': { alt: 'Двухцветное худи с эффектом стирки', width: 723, height: 558 },
  'tee-black.webp': { alt: 'Чёрная футболка с белым кантом', width: 614, height: 631 },
  'rally-jacket.webp': { alt: 'Мотокуртка из экокожи с чёрно-белыми вставками и нашивками', width: 722, height: 549 },
  'sprint-tee.webp': { alt: 'Чёрная джерси-футболка с белым кантом и принтом на груди', width: 594, height: 537 },
  'shade-pullover.webp': { alt: 'Серый пуловер с балаклавой и молнией, эффект стирки', width: 517, height: 726 },
  'orbit-tee.webp': { alt: 'Графитовая футболка с серым кантом и металлической звездой', width: 712, height: 666 },
  'vector-jacket.webp': { alt: 'Коричневая куртка со светлыми фигурными вставками и стойкой', width: 654, height: 585 },
  'arc-crewneck.webp': { alt: 'Серо-голубой свитшот с белыми вставками и кантом', width: 700, height: 635 },
  'relay-jacket.webp': { alt: 'Чёрно-синяя олимпийка с бежевыми вставками и полосками на рукавах', width: 1152, height: 681 },
  'line-jacket.webp': { alt: 'Чёрная олимпийка на молнии с белым кантом', width: 536, height: 407 },
  // Street-style shots for the hero and the "Follow along" block (full photos, not cut out).
  'hero-1.webp': { alt: 'Чёрный пуховик и серые широкие джинсы у строительного забора', width: 640, height: 800 },
  'hero-2.webp': { alt: 'Укороченный чёрный пуховик и тёмные джинсы в Париже', width: 627, height: 910 },
  'hero-3.webp': { alt: 'Оливковый пуховик и чёрные джоггеры на парковке', width: 900, height: 1203 },
  'street-1.webp': { alt: 'Серый пуховик на пешеходном переходе', width: 536, height: 892 },
  'street-2.webp': { alt: 'Чёрный пуховик поверх серого худи', width: 736, height: 920 },
  'street-3.webp': { alt: 'Оливковый пуховик на парковке', width: 800, height: 1069 },
  'street-4.webp': { alt: 'Укороченный чёрный пуховик с широкими джинсами', width: 627, height: 910 },
} as const;
type Photo = keyof typeof PHOTOS;

type DemoProduct = { slug: string; title: string; kind: GarmentKind; color: { name: string; hex: string }; price: number; gender?: ProductInput['gender']; fabric?: string; photo: Photo };

const products: DemoProduct[] = [
  { slug: 'quilt-puffer-black', title: 'Quilt Puffer (Black)', kind: 'puffer', color: { name: 'Black', hex: '#141414' }, price: 300, photo: 'puffer-black.webp' },
  { slug: 'storm-fleece-ash', title: 'Storm Fleece (Ash Black)', kind: 'fleece', color: { name: 'Ash', hex: '#2b2b2d' }, price: 150, gender: 'MAN', photo: 'track-jacket.webp' },
  { slug: 'heat-shell-graphite', title: 'Heat Shell (Graphite)', kind: 'puffer', color: { name: 'Graphite', hex: '#3a3c40' }, price: 280, photo: 'puffer-gloss.webp' },
  { slug: 'drift-puffer-navy', title: 'Drift Puffer (Navy)', kind: 'puffer', color: { name: 'Navy', hex: '#1c2740' }, price: 320, gender: 'MAN', photo: 'puffer-shine.webp' },
  { slug: 'night-hoodie-black', title: 'Night Hoodie (Black)', kind: 'hoodie', color: { name: 'Black', hex: '#161616' }, price: 140, photo: 'hoodie.webp' },
  { slug: 'signal-tee-black', title: 'Signal Tee (Black)', kind: 'tee', color: { name: 'Black', hex: '#151515' }, price: 60, photo: 'tee-black.webp' },
  { slug: 'quilt-puffer-stone', title: 'Quilt Puffer (Stone)', kind: 'puffer', color: { name: 'Stone', hex: '#8f8a83' }, price: 300, gender: 'WOMAN', photo: 'puffer-pink-hood.webp' },
  { slug: 'frost-parka-black', title: 'Frost Parka (Black)', kind: 'puffer', color: { name: 'Black', hex: '#121212' }, price: 380, photo: 'puffer-fur.webp' },
  { slug: 'rally-jacket-black', title: 'Rally Jacket (Black)', kind: 'fleece', color: { name: 'Black', hex: '#141414' }, price: 260, fabric: 'Экокожа', photo: 'rally-jacket.webp' },
  { slug: 'sprint-tee-black', title: 'Sprint Tee (Black)', kind: 'tee', color: { name: 'Black', hex: '#121212' }, price: 70, photo: 'sprint-tee.webp' },
  { slug: 'shade-pullover-grey', title: 'Shade Pullover (Washed Grey)', kind: 'hoodie', color: { name: 'Washed Grey', hex: '#6b6b6b' }, price: 190, photo: 'shade-pullover.webp' },
  { slug: 'orbit-tee-charcoal', title: 'Orbit Tee (Charcoal)', kind: 'tee', color: { name: 'Charcoal', hex: '#4a4a4c' }, price: 65, photo: 'orbit-tee.webp' },
  { slug: 'vector-jacket-coffee', title: 'Vector Jacket (Coffee)', kind: 'fleece', color: { name: 'Coffee', hex: '#3b3631' }, price: 240, fabric: 'Нейлон', photo: 'vector-jacket.webp' },
  { slug: 'arc-crewneck-slate', title: 'Arc Crewneck (Slate)', kind: 'hoodie', color: { name: 'Slate', hex: '#6e7882' }, price: 120, fabric: 'Хлопок', photo: 'arc-crewneck.webp' },
  { slug: 'relay-jacket-navy', title: 'Relay Track Jacket (Navy)', kind: 'fleece', color: { name: 'Navy', hex: '#262b3a' }, price: 220, fabric: 'Нейлон', photo: 'relay-jacket.webp' },
  { slug: 'line-jacket-black', title: 'Line Track Jacket (Black)', kind: 'fleece', color: { name: 'Black', hex: '#111111' }, price: 180, fabric: 'Полиэстер', photo: 'line-jacket.webp' },
];
/** Earlier demo products that had no photo of their own: archived on re-seed (not deleted, orders may point at them). */
const RETIRED = ['storm-fleece-fog', 'cloud-hoodie-ice', 'signal-tee-bone', 'static-tee-grey', 'mono-tee-black'];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const TEE_TEXT = ['Плотный хлопок 280 г/м²', 'Свободный крой, спущенное плечо', 'Объёмный принт', 'Не садится после стирки'];
const OUTER_TEXT = ['Прямой крой', 'Водоотталкивающая ткань', 'Двусторонняя молния с ветрозащитной планкой', 'Регулируемые капюшон и низ', 'Вышитый логотип на груди'];

const art = (from: string, to: string) => ({ from, to });
const shot = (file: Photo) => ({ type: 'image' as const, src: `/demo/${file}`, alt: PHOTOS[file].alt });

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
    const fabric = p.fabric ?? (isTee ? 'Хлопок' : p.kind === 'puffer' ? 'Нейлон' : 'Флис');
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
        { icon: 'truck', title: 'Бесплатная доставка', text: 'При заказе от $150' },
        { icon: 'shield', title: 'Безопасная оплата', text: 'Защищённое оформление — покупайте спокойно' },
        { icon: 'returns', title: 'Простой возврат', text: 'Без лишних вопросов в течение 30 дней' },
        { icon: 'globe', title: 'Доставка по всему миру', text: 'Привезём до двери, где бы вы ни были' },
      ],
      paymentBadges: ['Visa', 'Mastercard', 'Apple Pay', 'Google Pay'],
      footer: {
        menu: [
          { label: 'Все товары', path: '/collections/fw26' },
          { label: 'Верхняя одежда', path: '/collections/outerwear' },
          { label: 'Футболки', path: '/collections/tops' },
          { label: 'Лукбук', path: '/lookbook' },
        ],
        help: [
          { label: 'Доставка', path: '/pages/shipping' },
          { label: 'Возврат', path: '/pages/returns' },
          { label: 'Условия', path: '/pages/terms' },
          { label: 'Конфиденциальность', path: '/pages/privacy' },
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
        eyebrow: '',
        title: 'FW26',
        subtitle: 'Для тех, кто живёт ночью',
        panels: [shot('hero-1.webp'), shot('hero-2.webp'), shot('hero-3.webp')],
      },
      featured: {
        enabled: true,
        title: 'Featured',
        subtitle: 'Выбор сезона',
        productSlugs: ['quilt-puffer-black', 'storm-fleece-ash', 'drift-puffer-navy', 'signal-tee-black', 'heat-shell-graphite', 'frost-parka-black'],
      },
      grid: { enabled: true, title: 'New in', collection: 'fw26' },
      drop: { enabled: true, eyebrow: 'Следующий дроп', title: 'The Midnight Collection', endsAt: '2026-12-12T18:00:00Z', panel: shot('puffer-fur.webp') },
      collections: { enabled: true, slugs: collections.map((c) => c.slug) },
      social: {
        enabled: true,
        handle: '@ashen.studio',
        panels: [
          shot('street-1.webp'),
          shot('street-2.webp'),
          shot('street-3.webp'),
          shot('street-4.webp'),
        ],
      },
    },
    testimonials: [
      { quote: 'Сел ровно так, как подсказал подбор размера. Самая тёплая куртка из всех, что у меня есть.', author: 'Mila R.', location: 'Берлин' },
      { quote: 'Доставка заняла три дня, а качество невероятное для такой цены.', author: 'Daniel K.', location: 'Варшава' },
      { quote: 'Флис плотный — в лучшем смысле. Уже заказал второй цвет.', author: 'Aisha T.', location: 'Лондон' },
    ],
    playlist: await Promise.all(
      tracks.map(async (t, i) => ({ title: t.title, artist: t.artist, durationSec: t.durationSec, coverMediaId: await media(`tracks/${i}`, t.art, t.title), audioMediaId: null })),
    ),
    lookbook: {
      title: 'Ashen gallery',
      subtitle: 'Визуальная история новой коллекции',
      items: await Promise.all(
        lookbook.map(async (l, i) => ({ mediaId: await photo(l.photo), tag: l.tag, title: l.title, caption: l.caption })),
      ),
    },
  };
  await db.$transaction((tx) => writeStorefrontContent(tx, organizationId, content));
  return { products: products.length, collections: collections.length };
}
