import type { GarmentKind, Media, Panel, SizeChart, StoreProduct } from '@repo/shared';

/** Pure DB-row → storefront view-model mapping (no I/O), so it is unit-testable. */

export const ART_MIME = 'application/vnd.platform.art+json';

export interface MediaRow {
  id: string;
  storageKey: string;
  mimeType: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  meta: unknown;
}

type ArtMeta = { kind?: GarmentKind; view?: 'front' | 'back'; from?: string; to?: string; garment?: { kind: GarmentKind; tone: string } };

/** Where uploaded files are served from (Supabase Storage public bucket "media"). */
export const mediaUrl = (supabaseUrl: string | undefined, key: string) =>
  `${(supabaseUrl ?? '').replace(/\/$/, '')}/storage/v1/object/public/media/${key.split('/').map(encodeURIComponent).join('/')}`;

const FALLBACK = { from: '#3b3f46', to: '#16181b' };

export function toMedia(file: MediaRow, url: (key: string) => string): Media {
  const alt = file.alt ?? '';
  if (file.mimeType === ART_MIME) {
    const meta = (file.meta ?? {}) as ArtMeta;
    return { type: 'art', kind: meta.kind ?? 'tee', view: meta.view ?? 'front', alt };
  }
  return { type: 'image', src: url(file.storageKey), alt };
}

export function toPanel(file: MediaRow | null | undefined, url: (key: string) => string): Panel {
  if (!file) return { type: 'art', ...FALLBACK, alt: '' };
  const alt = file.alt ?? '';
  if (file.mimeType === ART_MIME) {
    const meta = (file.meta ?? {}) as ArtMeta;
    const garment = meta.garment ?? (meta.kind ? { kind: meta.kind, tone: '#1d1f22' } : undefined);
    return { type: 'art', from: meta.from ?? FALLBACK.from, to: meta.to ?? FALLBACK.to, ...(garment && { garment }), alt };
  }
  return { type: 'image', src: url(file.storageKey), alt };
}

export interface ProductRow {
  slug: string;
  title: string;
  description: string;
  label: string | null;
  gender: 'WOMAN' | 'MAN' | 'UNISEX';
  sizeChart: { columns: unknown; rows: unknown } | null;
  options: { name: string; values: { id: string; value: string; swatchHex: string | null }[] }[];
  variants: { id: string; priceMinor: bigint; stock: number; isActive: boolean; optionValues: { optionValueId: string }[] }[];
  media: { mediaFile: MediaRow }[];
}

const optionNamed = (p: ProductRow, ...names: string[]) => p.options.find((o) => names.includes(o.name.trim().toLowerCase()));

export function toStoreProduct(p: ProductRow, currency: string, collections: string[], url: (key: string) => string): StoreProduct {
  const active = p.variants.filter((v) => v.isActive);
  const priced = active.length ? active : p.variants;
  const price = priced.reduce((min, v) => (v.priceMinor < min ? v.priceMinor : min), priced[0]?.priceMinor ?? 0n);
  const inStock = (valueId?: string) => active.some((v) => v.stock > 0 && (!valueId || v.optionValues.some((l) => l.optionValueId === valueId)));

  const size = optionNamed(p, 'size');
  const color = optionNamed(p, 'color', 'colour');
  const fabric = optionNamed(p, 'fabric', 'material');
  return {
    slug: p.slug,
    title: p.title,
    ...(p.label && { label: p.label }),
    price: { amountMinor: Number(price), currency },
    gender: p.gender.toLowerCase() as StoreProduct['gender'],
    collections,
    // A product without a Color option still gets one neutral swatch, so the page always has a colour to show.
    colors: color?.values.map((v) => ({ name: v.value, hex: v.swatchHex ?? '#888888' })) ?? [{ name: 'Default', hex: '#9a9a9a' }],
    sizes: size ? size.values.map((v) => ({ label: v.value, inStock: inStock(v.id) })) : [{ label: 'One size', inStock: inStock() }],
    variants: active.map((v) => ({
      id: v.id,
      size: size ? (size.values.find((x) => v.optionValues.some((l) => l.optionValueId === x.id))?.value ?? null) : null,
      color: color ? (color.values.find((x) => v.optionValues.some((l) => l.optionValueId === x.id))?.value ?? null) : null,
    })),
    fabrics: fabric?.values.map((v) => v.value) ?? [],
    media: p.media.map((m) => toMedia(m.mediaFile, url)),
    description: p.description
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    ...(p.sizeChart && { sizeChart: { columns: p.sizeChart.columns, rows: p.sizeChart.rows } as SizeChart }),
  };
}
