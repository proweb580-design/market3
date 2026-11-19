import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_DB, type TestCtx } from './helpers.js';

const SECRET = 'cron-secret-for-tests-0123456789';

describe.skipIf(!TEST_DB)('scheduled job endpoints (Vercel Cron)', () => {
  let t: TestCtx;
  beforeAll(async () => {
    t = await createTestApp({ CRON_SECRET: SECRET });
  });
  afterAll(() => t.close());

  const call = (path: string, auth?: string) => {
    const r = t.http().get(`/api/v1/internal/cron/${path}`);
    return auth ? r.set('Authorization', auth) : r;
  };

  it('rejects missing and wrong credentials', async () => {
    for (const path of ['orders', 'subscriptions']) {
      await call(path).expect(401);
      await call(path, 'Bearer wrong').expect(401);
      await call(path, SECRET).expect(401); // the scheme matters
    }
  });

  it('runs both jobs with the secret', async () => {
    expect((await call('orders', `Bearer ${SECRET}`).expect(200)).body).toEqual({ canceled: expect.any(Number) });
    expect((await call('subscriptions', `Bearer ${SECRET}`).expect(200)).body).toMatchObject({ checked: expect.any(Number) });
  });

  it('is disabled (503) when CRON_SECRET is not configured', async () => {
    const bare = await createTestApp();
    try {
      await bare.http().get('/api/v1/internal/cron/orders').set('Authorization', `Bearer ${SECRET}`).expect(503);
    } finally {
      await bare.close();
    }
  });
});
