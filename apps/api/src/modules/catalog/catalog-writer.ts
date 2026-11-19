import { NotFoundException } from '@nestjs/common';
import type { CollectionInput, ProductInput, StorefrontContent } from '@repo/shared';
import type { Prisma } from '../../generated/prisma/client.js';

/*
 * Catalogue writes as plain functions over a transaction client, shared by the API services and the dev seed.
 * Every referenced id is checked against the organization first: a foreign id behaves exactly like a missing one (404).
 */

type Tx = Prisma.TransactionClient;

async function expectCount(count: Promise<number>, expected: number, what: string) {
  if ((await count) !== expected) throw new NotFoundException(`${what} not found`);
}

export async function assertOwned(
  tx: Tx,
  organizationId: string,
  refs: { mediaIds?: string[]; collectionIds?: string[]; productIds?: string[]; sizeChartId?: string | null },
) {
  const unique = (ids: string[] = []) => [...new Set(ids)];
  const media = unique(refs.mediaIds);
  const collections = unique(refs.collectionIds);
  const products = unique(refs.productIds);
  await Promise.all([
    media.length && expectCount(tx.mediaFile.count({ where: { organizationId, id: { in: media } } }), media.length, 'Media'),
    collections.length && expectCount(tx.collection.count({ where: { organizationId, id: { in: collections } } }), collections.length, 'Collection'),
    products.length && expectCount(tx.product.count({ where: { organizationId, id: { in: products } } }), products.length, 'Product'),
    refs.sizeChartId && expectCount(tx.sizeChart.count({ where: { organizationId, id: refs.sizeChartId } }), 1, 'Size chart'),
  ]);
}

/** Creates (no `productId`) or fully replaces a product. Variants listed with an id keep it, so carts and orders stay linked. */
export async function writeProduct(tx: Tx, organizationId: string, input: ProductInput, productId?: string) {
  await assertOwned(tx, organizationId, input);
  const existing = productId ? await tx.product.findFirst({ where: { id: productId, organizationId } }) : null;
  if (productId && !existing) throw new NotFoundException('Product not found');

  const data = {
    slug: input.slug,
    title: input.title,
    description: input.description,
    label: input.label ?? null,
    status: input.status,
    gender: input.gender,
    sizeChartId: input.sizeChartId ?? null,
    sortOrder: input.sortOrder,
    publishedAt: input.status === 'ACTIVE' ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
  };

  let id: string;
  if (existing) {
    id = existing.id;
    const keep = input.variants.flatMap((v) => (v.id ? [v.id] : []));
    await expectCount(tx.productVariant.count({ where: { productId: id, id: { in: keep } } }), new Set(keep).size, 'Variant');
    await tx.product.update({ where: { id }, data });
    await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keep } } });
    // Options are rebuilt; this also drops the old variant ↔ value links (cascade), relinked below.
    await tx.productOption.deleteMany({ where: { productId: id } });
    await tx.productMedia.deleteMany({ where: { productId: id } });
    await tx.collectionProduct.deleteMany({ where: { productId: id, collectionId: { notIn: input.collectionIds } } });
  } else {
    if (input.variants.some((v) => v.id)) throw new NotFoundException('Variant not found');
    id = (await tx.product.create({ data: { ...data, organizationId } })).id;
  }

  const valueId = new Map<string, string>();
  for (const [position, option] of input.options.entries()) {
    const created = await tx.productOption.create({
      data: {
        productId: id,
        name: option.name,
        position,
        values: { create: option.values.map((v, i) => ({ value: v.value, swatchHex: v.swatchHex ?? null, position: i })) },
      },
      include: { values: true },
    });
    for (const v of created.values) valueId.set(`${option.name}\u0000${v.value}`, v.id);
  }

  for (const [position, v] of input.variants.entries()) {
    const fields = {
      sku: v.sku ?? null,
      priceMinor: BigInt(v.priceMinor),
      compareAtPriceMinor: v.compareAtPriceMinor == null ? null : BigInt(v.compareAtPriceMinor),
      stock: v.stock,
      isActive: v.isActive,
      position,
      optionValues: { create: Object.entries(v.options).map(([name, value]) => ({ optionValueId: valueId.get(`${name}\u0000${value}`)! })) },
    };
    if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: fields });
    else await tx.productVariant.create({ data: { ...fields, organizationId, productId: id } });
  }

  if (input.mediaIds.length) {
    await tx.productMedia.createMany({ data: input.mediaIds.map((mediaFileId, position) => ({ productId: id, mediaFileId, position })) });
  }

  // New collection memberships go to the end of each collection.
  const linked = new Set((await tx.collectionProduct.findMany({ where: { productId: id }, select: { collectionId: true } })).map((l) => l.collectionId));
  for (const collectionId of input.collectionIds.filter((c) => !linked.has(c))) {
    const last = await tx.collectionProduct.aggregate({ where: { collectionId }, _max: { position: true } });
    await tx.collectionProduct.create({ data: { collectionId, productId: id, position: (last._max.position ?? -1) + 1 } });
  }
  return id;
}

/** Creates (no `collectionId`) or fully replaces a collection, including its product order. */
export async function writeCollection(tx: Tx, organizationId: string, input: CollectionInput, collectionId?: string) {
  await assertOwned(tx, organizationId, { productIds: input.productIds, mediaIds: input.imageId ? [input.imageId] : [] });
  const data = {
    slug: input.slug,
    title: input.title,
    description: input.description ?? null,
    imageId: input.imageId ?? null,
    sortOrder: input.sortOrder,
    isPublished: input.isPublished,
  };
  let id: string;
  if (collectionId) {
    const found = await tx.collection.findFirst({ where: { id: collectionId, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Collection not found');
    id = found.id;
    await tx.collection.update({ where: { id }, data });
    await tx.collectionProduct.deleteMany({ where: { collectionId: id } });
  } else {
    id = (await tx.collection.create({ data: { ...data, organizationId } })).id;
  }
  if (input.productIds.length) {
    await tx.collectionProduct.createMany({ data: input.productIds.map((productId, position) => ({ collectionId: id, productId, position })) });
  }
  return id;
}

const SECTION_TYPES = {
  hero: 'HERO',
  featured: 'FEATURED',
  grid: 'PRODUCT_GRID',
  drop: 'DROP_COUNTDOWN',
  collections: 'COLLECTIONS',
  social: 'SOCIAL_FEED',
} as const;
export type SectionName = keyof typeof SECTION_TYPES;
export const SECTION_BY_TYPE = Object.fromEntries(Object.entries(SECTION_TYPES).map(([k, v]) => [v, k])) as Record<string, SectionName>;

/** Replaces the whole storefront content document in one transaction. */
export async function writeStorefrontContent(tx: Tx, organizationId: string, doc: StorefrontContent) {
  await assertOwned(tx, organizationId, {
    mediaIds: [
      ...doc.playlist.flatMap((t) => [t.coverMediaId, t.audioMediaId].filter((x): x is string => !!x)),
      ...(doc.lookbook?.items.map((i) => i.mediaId) ?? []),
    ],
  });

  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const settings = { ...(org.settings as Record<string, unknown> | null), storefront: doc.settings };
  await tx.organization.update({ where: { id: organizationId }, data: { settings } });

  await tx.homeSection.deleteMany({ where: { organizationId } });
  await tx.homeSection.createMany({
    data: (Object.keys(SECTION_TYPES) as SectionName[]).map((name, position) => {
      const { enabled, ...config } = doc.sections[name];
      return { organizationId, type: SECTION_TYPES[name], position, isEnabled: enabled, config };
    }),
  });

  await tx.testimonial.deleteMany({ where: { organizationId } });
  await tx.testimonial.createMany({ data: doc.testimonials.map((t, position) => ({ organizationId, ...t, position })) });

  await tx.playlistTrack.deleteMany({ where: { organizationId } });
  await tx.playlistTrack.createMany({
    data: doc.playlist.map((t, position) => ({
      organizationId,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      coverFileId: t.coverMediaId,
      audioFileId: t.audioMediaId,
      position,
    })),
  });

  if (!doc.lookbook) {
    await tx.lookbook.deleteMany({ where: { organizationId } });
  } else {
    const { items, ...fields } = doc.lookbook;
    const lookbook = await tx.lookbook.upsert({
      where: { organizationId_slug: { organizationId, slug: 'main' } },
      update: { ...fields, isPublished: true },
      create: { organizationId, slug: 'main', ...fields, isPublished: true },
    });
    await tx.lookbookItem.deleteMany({ where: { lookbookId: lookbook.id } });
    await tx.lookbookItem.createMany({ data: items.map((i, position) => ({ lookbookId: lookbook.id, mediaFileId: i.mediaId, tag: i.tag, title: i.title, caption: i.caption, position })) });
  }
}
