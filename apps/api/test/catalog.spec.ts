import { productInputSchema, type ProductInput, type StorefrontContent } from '@repo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ART_MIME, toStoreProduct, type ProductRow } from '../src/modules/catalog/view.js';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

const product = (slug: string, extra: Partial<ProductInput> = {}): ProductInput =>
  productInputSchema.parse({
    slug,
    title: `Product ${slug}`,
    description: 'Warm\n\n  Water-repellent  ',
    status: 'ACTIVE',
    options: [
      { name: 'Size', values: [{ value: 'S' }, { value: 'M' }] },
      { name: 'Color', values: [{ value: 'Black', swatchHex: '#111111' }] },
    ],
    variants: [
      { options: { Size: 'S', Color: 'Black' }, sku: `${slug}-s`, priceMinor: 12000, stock: 0 },
      { options: { Size: 'M', Color: 'Black' }, sku: `${slug}-m`, priceMinor: 10000, stock: 3 },
    ],
    ...extra,
  });

const content = (over: Partial<StorefrontContent> = {}): StorefrontContent => ({
  settings: { freeShippingThresholdMinor: 5000, shippingFlatMinor: 0, trust: [], paymentBadges: ['Visa'], footer: { menu: [{ label: 'All', path: '/collections/all' }], help: [], socials: [] } },
  sections: {
    hero: { enabled: true, eyebrow: 'New', title: 'Drop', subtitle: '', panels: [{ type: 'art', from: '#000000', to: '#111111', alt: '' }] },
    featured: { enabled: false, title: 'Featured', subtitle: '', productSlugs: [] },
    grid: { enabled: true, title: 'New in', collection: 'all' },
    drop: { enabled: true, eyebrow: 'Soon', title: 'Next', endsAt: '2030-01-01T00:00:00Z', panel: { type: 'art', from: '#000000', to: '#111111', alt: '' } },
    collections: { enabled: true, slugs: ['all'] },
    social: { enabled: false, handle: '', panels: [] },
  },
  testimonials: [{ author: 'A', location: 'B', quote: 'Great' }],
  playlist: [{ title: 'T', artist: 'A', durationSec: 60, coverMediaId: null, audioMediaId: null }],
  lookbook: null,
  ...over,
});

describe('catalog view mapping (unit)', () => {
  const row = (variants: ProductRow['variants'], options: ProductRow['options'] = []): ProductRow => ({
    slug: 'p',
    title: 'P',
    description: 'One\n\n two ',
    label: null,
    gender: 'MAN',
    sizeChart: null,
    options,
    variants,
    media: [{ mediaFile: { id: 'm', storageKey: 'org/a b.jpg', mimeType: 'image/jpeg', alt: null, width: 1, height: 1, meta: null } }],
  });

  it('prices from the cheapest active variant and marks sizes by stock of active variants', () => {
    const options = [{ name: 'Size', values: [{ id: 's', value: 'S', swatchHex: null }, { id: 'm', value: 'M', swatchHex: null }] }];
    const p = toStoreProduct(
      row(
        [
          { id: 'v1', priceMinor: 500n, stock: 9, isActive: false, optionValues: [{ optionValueId: 's' }] },
          { id: 'v2', priceMinor: 900n, stock: 0, isActive: true, optionValues: [{ optionValueId: 's' }] },
          { id: 'v3', priceMinor: 800n, stock: 2, isActive: true, optionValues: [{ optionValueId: 'm' }] },
        ],
        options,
      ),
      'EUR',
      ['c'],
      (k) => `https://cdn/${k}`,
    );
    expect(p.price).toEqual({ amountMinor: 800, currency: 'EUR' });
    expect(p.sizes).toEqual([{ label: 'S', inStock: false }, { label: 'M', inStock: true }]);
    expect(p.variants).toEqual([{ id: 'v2', size: 'S', color: null }, { id: 'v3', size: 'M', color: null }]);
    expect(p.colors).toEqual([{ name: 'Default', hex: '#9a9a9a' }]);
    expect(p.description).toEqual(['One', 'two']);
    expect(p.gender).toBe('man');
    expect(p.media).toEqual([{ type: 'image', src: 'https://cdn/org/a b.jpg', alt: '' }]);
  });

  it('falls back to "One size" when the product has no Size option', () => {
    const p = toStoreProduct(row([{ id: 'v4', priceMinor: 100n, stock: 1, isActive: true, optionValues: [] }]), 'USD', [], (k) => k);
    expect(p.sizes).toEqual([{ label: 'One size', inStock: true }]);
  });

  it('reads Russian option names (Размер, Цвет) like the English ones', () => {
    const options = [
      { name: 'Размер', values: [{ id: 's', value: 'S', swatchHex: null }] },
      { name: 'Цвет', values: [{ id: 'b', value: 'Чёрный', swatchHex: '#111111' }] },
    ];
    const p = toStoreProduct(row([{ id: 'v5', priceMinor: 100n, stock: 1, isActive: true, optionValues: [{ optionValueId: 's' }, { optionValueId: 'b' }] }], options), 'USD', [], (k) => k);
    expect(p.sizes).toEqual([{ label: 'S', inStock: true }]);
    expect(p.colors).toEqual([{ name: 'Чёрный', hex: '#111111' }]);
  });

  it('rejects inconsistent product documents', () => {
    const base = product('ok');
    expect(productInputSchema.safeParse({ ...base, variants: [{ ...base.variants[0], options: { Size: 'S' } }] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, variants: [{ ...base.variants[0], options: { Size: 'XL', Color: 'Black' } }] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, variants: [base.variants[0], base.variants[0]] }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, extra: true }).success).toBe(false);
    expect(ART_MIME).toMatch(/^application\//);
  });
});

describe.skipIf(!TEST_DB)('catalog and storefront', () => {
  let t: TestCtx;
  let owner: TestUser;
  let org: { id: string; slug: string };

  const pub = (path: string) => t.http().get(`/api/v1/storefront/${path}`);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.user('brand');
    org = await t.createOrg(owner);
  });
  afterAll(() => t.close());

  describe('products', () => {
    it('creates a product with options and variants and returns it with ids', async () => {
      const res = await owner.post(`/organizations/${org.id}/products`, product('jacket')).expect(201);
      expect(res.body).toMatchObject({ slug: 'jacket', status: 'ACTIVE', options: [{ name: 'Size' }, { name: 'Color' }] });
      expect(res.body.variants).toHaveLength(2);
      expect(res.body.variants[1]).toMatchObject({ options: { Size: 'M', Color: 'Black' }, priceMinor: 10000, stock: 3 });
      expect(res.body.publishedAt).toBeTruthy();
      expect(await t.db.auditLog.count({ where: { action: 'product.created', entityId: res.body.id } })).toBe(1);
    });

    it('PUT replaces the document but keeps the ids of listed variants', async () => {
      const created = (await owner.post(`/organizations/${org.id}/products`, product('replace-me')).expect(201)).body;
      const keep = created.variants[1];
      const next = product('replace-me', {
        title: 'Renamed',
        options: [{ name: 'Size', values: [{ value: 'M' }, { value: 'L' }] }],
        variants: [
          { id: keep.id, options: { Size: 'M' }, sku: 'rm-m', priceMinor: 11000, stock: 1, isActive: true },
          { options: { Size: 'L' }, sku: 'rm-l', priceMinor: 11000, stock: 1, isActive: true },
        ],
      });
      const res = await owner.put(`/organizations/${org.id}/products/${created.id}`, next).expect(200);
      expect(res.body.title).toBe('Renamed');
      expect(res.body.variants.map((v: { id: string }) => v.id)).toContain(keep.id);
      expect(res.body.variants.map((v: { options: object }) => v.options)).toEqual([{ Size: 'M' }, { Size: 'L' }]);
      expect(await t.db.productVariant.count({ where: { id: created.variants[0].id } })).toBe(0);
    });

    it('rejects duplicate slugs (409) and bad documents (400)', async () => {
      await owner.post(`/organizations/${org.id}/products`, product('dupe')).expect(201);
      await owner.post(`/organizations/${org.id}/products`, product('dupe', { variants: [{ options: { Size: 'S', Color: 'Black' }, priceMinor: 1, stock: 1, isActive: true }] })).expect(409);
      await owner.post(`/organizations/${org.id}/products`, { ...product('bad'), variants: [] }).expect(400);
      await owner.post(`/organizations/${org.id}/products`, { ...product('bad2'), organizationId: org.id }).expect(400);
    });

    it('lists with paging, status filter, search and a sort whitelist', async () => {
      await owner.post(`/organizations/${org.id}/products`, product('draft-one', { status: 'DRAFT' })).expect(201);
      const drafts = await owner.get(`/organizations/${org.id}/products?status=DRAFT`).expect(200);
      expect(drafts.body.items.map((p: { slug: string }) => p.slug)).toEqual(['draft-one']);
      const found = await owner.get(`/organizations/${org.id}/products?q=JACKET`).expect(200);
      expect(found.body.items[0]).toMatchObject({ slug: 'jacket', variantCount: 2, stock: 3, priceMinor: 10000 });
      await owner.get(`/organizations/${org.id}/products?sort=organizationId`).expect(400);
    });

    it('deletes a product; its order lines keep their snapshot', async () => {
      const p = (await owner.post(`/organizations/${org.id}/products`, product('to-delete')).expect(201)).body;
      const order = await t.db.order.create({
        data: {
          organizationId: org.id, number: 1, source: 'WEB', currency: 'USD', subtotalMinor: 100n, totalMinor: 100n,
          items: { create: { variantId: p.variants[0].id, productTitle: p.title, variantTitle: 'S', unitPriceMinor: 100n, quantity: 1, totalMinor: 100n } },
        },
      });
      await owner.del(`/organizations/${org.id}/products/${p.id}`).expect(204);
      await owner.get(`/organizations/${org.id}/products/${p.id}`).expect(404);
      const line = await t.db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(line).toMatchObject({ variantId: null, productTitle: p.title });
    });
  });

  describe('tenant isolation and permissions', () => {
    let other: TestUser;
    let otherOrg: { id: string };
    let foreign: { product: string; collection: string; chart: string; media: string };

    beforeAll(async () => {
      other = await t.user('rival');
      otherOrg = await t.createOrg(other);
      const p = (await other.post(`/organizations/${otherOrg.id}/products`, product('rival-item')).expect(201)).body;
      const c = (await other.post(`/organizations/${otherOrg.id}/collections`, { slug: 'rival', title: 'Rival' }).expect(201)).body;
      const chart = (await other.post(`/organizations/${otherOrg.id}/size-charts`, { name: 'R', columns: ['Chest'], rows: [{ size: 'M', chestCm: 50, values: ['50'] }] }).expect(201)).body;
      const media = await t.db.mediaFile.create({ data: { organizationId: otherOrg.id, storageKey: `${otherOrg.id}/x.jpg`, mimeType: 'image/jpeg', sizeBytes: 1n } });
      foreign = { product: p.id, collection: c.id, chart: chart.id, media: media.id };
    });

    it("another organization's objects are 404 through my organization's routes", async () => {
      await owner.get(`/organizations/${org.id}/products/${foreign.product}`).expect(404);
      await owner.put(`/organizations/${org.id}/products/${foreign.product}`, product('steal')).expect(404);
      await owner.del(`/organizations/${org.id}/products/${foreign.product}`).expect(404);
      await owner.get(`/organizations/${org.id}/collections/${foreign.collection}`).expect(404);
      await owner.del(`/organizations/${org.id}/size-charts/${foreign.chart}`).expect(404);
      // …and the rival's own routes are closed to me.
      await owner.get(`/organizations/${otherOrg.id}/products`).expect(404);
      expect(await t.db.product.count({ where: { id: foreign.product } })).toBe(1);
    });

    it("can't reference another organization's media, collections, size charts or variants", async () => {
      await owner.post(`/organizations/${org.id}/products`, product('x1', { mediaIds: [foreign.media] })).expect(404);
      await owner.post(`/organizations/${org.id}/products`, product('x2', { collectionIds: [foreign.collection] })).expect(404);
      await owner.post(`/organizations/${org.id}/products`, product('x3', { sizeChartId: foreign.chart })).expect(404);
      await owner.post(`/organizations/${org.id}/collections`, { slug: 'x4', title: 'X', productIds: [foreign.product] }).expect(404);
      await owner.post(`/organizations/${org.id}/collections`, { slug: 'x5', title: 'X', imageId: foreign.media }).expect(404);
      const rivalVariant = (await t.db.productVariant.findFirstOrThrow({ where: { productId: foreign.product } })).id;
      const mine = (await owner.post(`/organizations/${org.id}/products`, product('x6')).expect(201)).body;
      const hijack = product('x6');
      hijack.variants[0]!.id = rivalVariant;
      await owner.put(`/organizations/${org.id}/products/${mine.id}`, hijack).expect(404);
      await owner.put(`/organizations/${org.id}/storefront`, content({ playlist: [{ title: 'T', artist: 'A', durationSec: 5, coverMediaId: foreign.media, audioMediaId: null }] })).expect(404);
      expect(await t.db.product.count({ where: { organizationId: org.id, slug: { in: ['x1', 'x2', 'x3'] } } })).toBe(0);
    });

    it('staff can read the catalogue but not change it or the storefront', async () => {
      const staff = await t.user('staff');
      await t.addMember(org.id, staff, 'ORG_STAFF');
      await staff.get(`/organizations/${org.id}/products`).expect(200);
      await staff.post(`/organizations/${org.id}/products`, product('nope')).expect(403);
      await staff.put(`/organizations/${org.id}/storefront`, content()).expect(403);
      await t.http().get(`/api/v1/organizations/${org.id}/products`).expect(401);
    });
  });

  describe('plan limits', () => {
    it('blocks creating products beyond the plan limit with 402, editing still works', async () => {
      const free = await t.createOrg(owner, undefined, 'FREE');
      await t.db.product.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ organizationId: free.id, slug: `p-${i}`, title: `P${i}` })) });
      const res = await owner.post(`/organizations/${free.id}/products`, product('eleventh')).expect(402);
      expect(res.body.details.code).toBe('PLAN_RESTRICTION');
      const existing = await t.db.product.findFirstOrThrow({ where: { organizationId: free.id, slug: 'p-0' } });
      await owner.put(`/organizations/${free.id}/products/${existing.id}`, product('p-0')).expect(200);
    });
  });

  describe('public storefront', () => {
    let store: { id: string; slug: string };

    beforeAll(async () => {
      store = await t.createOrg(owner);
      const live = (await owner.post(`/organizations/${store.id}/products`, product('live')).expect(201)).body;
      const draft = (await owner.post(`/organizations/${store.id}/products`, product('hidden', { status: 'DRAFT' })).expect(201)).body;
      await owner.post(`/organizations/${store.id}/collections`, { slug: 'all', title: 'All', productIds: [draft.id, live.id] }).expect(201);
      await owner.post(`/organizations/${store.id}/collections`, { slug: 'secret', title: 'Secret', isPublished: false, productIds: [live.id] }).expect(201);
      await owner.put(`/organizations/${store.id}/storefront`, content()).expect(200);
    });

    it('serves the published catalogue without authentication and without private fields', async () => {
      const res = await pub(`${store.slug}/catalog`).expect(200);
      expect(res.body.products.map((p: { slug: string }) => p.slug)).toEqual(['live']);
      expect(res.body.collections).toEqual([{ slug: 'all', title: 'All', productSlugs: ['live'] }]);
      const live = res.body.products[0];
      expect(live).toMatchObject({ collections: ['all'], price: { amountMinor: 10000, currency: 'USD' }, sizes: [{ label: 'S', inStock: false }, { label: 'M', inStock: true }] });
      const text = JSON.stringify(res.body);
      for (const secret of ['stock', 'sku', 'organizationId', 'hidden', 'secret', 'live-s']) expect(text).not.toContain(secret);
    });

    it('serves the home page document, with plan-gated sections removed', async () => {
      const res = await pub(store.slug).expect(200);
      expect(res.body).toMatchObject({ slug: store.slug, freeShippingThresholdMinor: 5000, featured: null, social: null, grid: { collection: 'all' } });
      expect(res.body.drop?.title).toBe('Next');
      expect(res.body.playlist).toHaveLength(1);
      expect(res.body.collections).toEqual([{ slug: 'all', title: 'All', panel: expect.objectContaining({ type: 'art' }) }]);

      const basic = await t.db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
      await t.db.subscription.updateMany({ where: { organizationId: store.id, status: 'ACTIVE' }, data: { planId: basic.id } });
      const gated = await pub(store.slug).expect(200);
      expect(gated.body.drop).toBeNull();
      expect(gated.body.playlist).toEqual([]);
      // The brand's content is kept, it just isn't shown.
      expect(await t.db.playlistTrack.count({ where: { organizationId: store.id } })).toBe(1);
    });

    it('round-trips the storefront document for the dashboard', async () => {
      const res = await owner.get(`/organizations/${store.id}/storefront`).expect(200);
      expect(res.body.sections.hero).toMatchObject({ enabled: true, title: 'Drop' });
      expect(res.body.settings.paymentBadges).toEqual(['Visa']);
      expect(res.body.testimonials).toEqual([{ author: 'A', location: 'B', quote: 'Great' }]);
    });

    it('rejects links that leave the store and unknown fields', async () => {
      const bad = content();
      bad.settings.footer.menu = [{ label: 'Evil', path: '//evil.example' }];
      await owner.put(`/organizations/${store.id}/storefront`, bad).expect(400);
      const js = content();
      js.sections.hero.panels = [{ type: 'image', src: 'javascript:alert(1)', alt: '' }];
      await owner.put(`/organizations/${store.id}/storefront`, js).expect(400);
    });

    it('unknown and suspended stores are 404', async () => {
      await pub('no-such-store').expect(404);
      await pub('no-such-store/catalog').expect(404);
      await t.db.organization.update({ where: { id: store.id }, data: { status: 'SUSPENDED' } });
      await pub(store.slug).expect(404);
      await pub(`${store.slug}/catalog`).expect(404);
    });
  });
});
