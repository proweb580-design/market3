import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectStorage } from '../src/modules/media/object-storage.js';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

/** In-memory storage: `upload()` plays the browser putting the file after getting a signed token. */
function fakeStorage() {
  const objects = new Map<string, { size: number; contentType: string }>();
  const storage: ObjectStorage = {
    ensureBucket: async () => undefined,
    createUpload: async (path) => ({ token: `tok-${path}` }),
    stat: async (path) => objects.get(path) ?? null,
    remove: async (path) => void objects.delete(path),
  };
  return { storage, objects, upload: (path: string, size: number, contentType: string) => objects.set(path, { size, contentType }) };
}

const SECRET = 'media-test-secret-0123456789-abcdefgh';
const png = (over: object = {}) => ({ mimeType: 'image/png', sizeBytes: 5000, width: 800, height: 1000, alt: 'A shirt', ...over });

describe.skipIf(!TEST_DB)('media uploads', () => {
  let t: TestCtx;
  let fake: ReturnType<typeof fakeStorage>;
  let owner: TestUser;
  let org: { id: string; slug: string };

  const intent = (body: object, u = owner, orgId = org.id) => u.post(`/organizations/${orgId}/media/upload-url`, body);
  /** Full happy path, returns the recorded media. */
  const uploadPng = async (over: object = {}) => {
    const body = png(over);
    const { path, ticket } = (await intent(body).expect(200)).body;
    fake.upload(path, body.sizeBytes, body.mimeType);
    return (await owner.post(`/organizations/${org.id}/media`, { ticket }).expect(201)).body;
  };

  beforeAll(async () => {
    fake = fakeStorage();
    t = await createTestApp({ JWT_SECRET: SECRET, SUPABASE_URL: 'https://proj.supabase.co' }, { storage: fake.storage });
    owner = await t.user('uploader');
    org = await t.createOrg(owner);
  });
  afterAll(() => t.close());

  it('issues a signed upload token for an agreed file, scoped to the store, without recording anything yet', async () => {
    const res = await intent(png()).expect(200);
    expect(res.body.path).toMatch(new RegExp(`^${org.id}/[0-9a-f-]{36}\\.png$`));
    expect(res.body.token).toBe(`tok-${res.body.path}`);
    expect(await t.db.mediaFile.count({ where: { storageKey: res.body.path } })).toBe(0);
  });

  it('records the file only after it really arrived, with the agreed size and type', async () => {
    const media = await uploadPng();
    expect(media).toMatchObject({ mimeType: 'image/png', sizeBytes: 5000, width: 800, alt: 'A shirt', url: expect.stringMatching(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/media\//) });
    const listed = await owner.get(`/organizations/${org.id}/media`).expect(200);
    expect(listed.body.items.map((m: { id: string }) => m.id)).toContain(media.id);
    expect(await t.db.auditLog.count({ where: { action: 'media.uploaded', entityId: media.id } })).toBe(1);
  });

  it('confirming twice returns the same record', async () => {
    const { path, ticket } = (await intent(png()).expect(200)).body;
    fake.upload(path, 5000, 'image/png');
    const a = (await owner.post(`/organizations/${org.id}/media`, { ticket }).expect(201)).body;
    const b = (await owner.post(`/organizations/${org.id}/media`, { ticket }).expect(201)).body;
    expect(b.id).toBe(a.id);
  });

  it('refuses a confirm when nothing was uploaded, and deletes a file that is not what was declared', async () => {
    const none = (await intent(png()).expect(200)).body;
    await owner.post(`/organizations/${org.id}/media`, { ticket: none.ticket }).expect(422);

    const swapped = (await intent(png()).expect(200)).body;
    fake.upload(swapped.path, 9_999_999, 'text/html'); // a different, bigger file than agreed
    await owner.post(`/organizations/${org.id}/media`, { ticket: swapped.ticket }).expect(422);
    expect(fake.objects.has(swapped.path)).toBe(false);
    expect(await t.db.mediaFile.count({ where: { storageKey: swapped.path } })).toBe(0);
  });

  it('validates the request: type, size, extra fields', async () => {
    await intent(png({ mimeType: 'text/html' })).expect(400);
    await intent(png({ mimeType: 'application/pdf' })).expect(400);
    await intent(png({ sizeBytes: 9 * 1024 * 1024 })).expect(400); // images are capped at 8 MB
    await intent(png({ sizeBytes: 0 })).expect(400);
    await intent(png({ storageKey: 'other-org/x.png' })).expect(400);
  });

  it('rejects forged, edited, expired, and foreign tickets', async () => {
    const { path, ticket } = (await intent(png()).expect(200)).body;
    fake.upload(path, 5000, 'image/png');
    const [payload, sig] = ticket.split('.');
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), key: `${org.id}/../evil.png` })).toString('base64url');
    await owner.post(`/organizations/${org.id}/media`, { ticket: `${edited}.${sig}` }).expect(422);
    await owner.post(`/organizations/${org.id}/media`, { ticket: `${payload}.AAAA` }).expect(422);
    await owner.post(`/organizations/${org.id}/media`, { ticket: 'x'.repeat(40) }).expect(422);

    const other = await t.user('other-uploader');
    const otherOrg = await t.createOrg(other);
    await other.post(`/organizations/${otherOrg.id}/media`, { ticket }).expect(422); // my ticket, their store
    expect(await t.db.mediaFile.count({ where: { storageKey: path } })).toBe(0);
  });

  it('enforces permissions, tenant isolation and plan rules', async () => {
    const staff = await t.user('uploader-staff');
    await t.addMember(org.id, staff, 'ORG_STAFF');
    await intent(png(), staff).expect(403);
    await t.http().post(`/api/v1/organizations/${org.id}/media/upload-url`).send(png()).expect(401);
    const outsider = await t.user('outsider-uploader');
    await intent(png(), outsider).expect(404);

    // Audio needs the music-player feature; Basic doesn't have it.
    const basic = await t.db.plan.findUniqueOrThrow({ where: { code: 'BASIC' } });
    const smallOrg = await t.createOrg(owner);
    await t.db.subscription.updateMany({ where: { organizationId: smallOrg.id, status: 'ACTIVE' }, data: { planId: basic.id } });
    const audio = await intent({ mimeType: 'audio/mpeg', sizeBytes: 1000 }, owner, smallOrg.id).expect(402);
    expect(audio.body.details.feature).toBe('music_player');
    await intent({ mimeType: 'audio/mpeg', sizeBytes: 1000 }).expect(200); // Business has it
  });

  it('stops at the plan storage limit', async () => {
    const free = await t.createOrg(owner, undefined, 'FREE'); // 100 MB
    await t.db.mediaFile.create({ data: { organizationId: free.id, storageKey: `${free.id}/big.png`, mimeType: 'image/png', sizeBytes: BigInt(100 * 1_048_576) } });
    const res = await intent(png(), owner, free.id).expect(402);
    expect(res.body.details).toMatchObject({ limit: 'storage.mb', allowed: 100 });
  });

  it('deletes unused files (row and object) but refuses files still in use', async () => {
    const used = await uploadPng();
    const product = await owner
      .post(`/organizations/${org.id}/products`, { slug: 'with-photo', title: 'P', status: 'ACTIVE', options: [], variants: [{ options: {}, priceMinor: 100, stock: 1 }], mediaIds: [used.id] })
      .expect(201);
    expect(product.body.media[0].id).toBe(used.id);
    await owner.del(`/organizations/${org.id}/media/${used.id}`).expect(409);

    const free = await uploadPng();
    const key = (await t.db.mediaFile.findUniqueOrThrow({ where: { id: free.id } })).storageKey;
    await owner.del(`/organizations/${org.id}/media/${free.id}`).expect(204);
    expect(fake.objects.has(key)).toBe(false);
    await owner.del(`/organizations/${org.id}/media/${free.id}`).expect(404);
    const rival = await t.user('rival-deleter');
    const rivalOrg = await t.createOrg(rival);
    await rival.del(`/organizations/${rivalOrg.id}/media/${used.id}`).expect(404);
  });

  it('answers 503 when storage is not configured, without breaking the rest', async () => {
    const bare = await createTestApp();
    try {
      const u = await bare.user('no-storage');
      const o = await bare.createOrg(u);
      await u.post(`/organizations/${o.id}/media/upload-url`, png()).expect(503);
      await u.get(`/organizations/${o.id}/media`).expect(200);
    } finally {
      await bare.close();
    }
  });
});
