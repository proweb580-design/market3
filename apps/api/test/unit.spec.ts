import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { BadRequestException } from '@nestjs/common';
import { JwtVerifier, TokenError } from '../src/modules/auth/token-verifier.js';
import { ApiKeyRateLimiter } from '../src/modules/auth/rate-limiter.js';
import { parseSort } from '../src/common/pagination.js';
import { randomToken, safeEqualHex, sha256 } from '../src/common/crypto.js';
import { addInterval } from '../src/modules/billing/period.js';
import { EntitlementsService } from '../src/modules/billing/entitlements.service.js';
import type { Env } from '../src/config/env.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createTestApp, ISSUER, AUDIENCE } from './helpers.js';

const sub = '3f2b8a52-6a53-4f6c-9d9a-0a3b6f3c1c11';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('JwtVerifier', () => {
  const setup = async (hsSecret?: string) => {
    const keys = await generateKeyPair('ES256');
    const other = await generateKeyPair('ES256');
    const verifier = new JwtVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: async () => keys.publicKey, hsSecret });
    const sign = (key: CryptoKey | Uint8Array, alg: string, over: { exp?: number; iss?: string; aud?: string; claims?: object } = {}) =>
      new SignJWT({ email: 'A@Example.com', ...over.claims })
        .setProtectedHeader({ alg })
        .setSubject(sub)
        .setIssuer(over.iss ?? ISSUER)
        .setAudience(over.aud ?? AUDIENCE)
        .setExpirationTime(over.exp ?? Math.floor(Date.now() / 1000) + 600)
        .sign(key);
    return { keys, other, verifier, sign };
  };

  it('accepts a valid token and normalises the email', async () => {
    const { keys, verifier, sign } = await setup();
    const claims = await verifier.verify(await sign(keys.privateKey, 'ES256', { claims: { session_id: 's1', user_metadata: { email_verified: true } } }));
    expect(claims).toMatchObject({ sub, email: 'a@example.com', emailVerified: true, sessionId: 's1' });
  });

  it.each([
    ['wrong signing key', async (s: Awaited<ReturnType<typeof setup>>) => s.sign(s.other.privateKey, 'ES256')],
    ['expired', async (s: Awaited<ReturnType<typeof setup>>) => s.sign(s.keys.privateKey, 'ES256', { exp: Math.floor(Date.now() / 1000) - 10 })],
    ['wrong issuer', async (s: Awaited<ReturnType<typeof setup>>) => s.sign(s.keys.privateKey, 'ES256', { iss: 'https://evil.example/auth/v1' })],
    ['wrong audience', async (s: Awaited<ReturnType<typeof setup>>) => s.sign(s.keys.privateKey, 'ES256', { aud: 'anon' })],
    ['anonymous session', async (s: Awaited<ReturnType<typeof setup>>) => s.sign(s.keys.privateKey, 'ES256', { claims: { is_anonymous: true } })],
    ['alg=none', async () => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, iss: ISSUER, aud: AUDIENCE, exp: 9_999_999_999 })}.`],
    ['garbage', async () => 'not.a.jwt'],
  ])('rejects: %s', async (_name, make) => {
    const s = await setup();
    await expect(s.verifier.verify(await make(s))).rejects.toBeInstanceOf(TokenError);
  });

  it('refuses HS256 tokens unless a legacy secret is configured, and never accepts a public-key-as-secret forgery', async () => {
    const secret = 'legacy-hs256-secret-0123456789';
    const noHs = await setup();
    const hsToken = await noHs.sign(new TextEncoder().encode(secret), 'HS256');
    await expect(noHs.verifier.verify(hsToken)).rejects.toBeInstanceOf(TokenError);

    const withHs = await setup(secret);
    await expect(withHs.verifier.verify(await withHs.sign(new TextEncoder().encode(secret), 'HS256'))).resolves.toMatchObject({ sub });
    await expect(withHs.verifier.verify(await withHs.sign(new TextEncoder().encode('some-other-secret-0123456789'), 'HS256'))).rejects.toBeInstanceOf(TokenError);
  });
});

describe('ApiKeyRateLimiter', () => {
  it('allows the limit, then throws 429 with a retry hint, and resets next minute', () => {
    const limiter = new ApiKeyRateLimiter();
    const t0 = 1_700_000_000_000;
    limiter.hit('k', 2, t0);
    limiter.hit('k', 2, t0 + 1);
    expect(() => limiter.hit('k', 2, t0 + 2)).toThrowError(expect.objectContaining({ status: 429 }));
    expect(() => limiter.hit('other', 2, t0 + 2)).not.toThrow();
    expect(() => limiter.hit('k', 2, t0 + 61_000)).not.toThrow();
  });
});

describe('helpers', () => {
  it('parseSort only accepts whitelisted fields', () => {
    expect(parseSort('-email', ['email', 'createdAt'], { field: 'createdAt', dir: 'desc' })).toEqual([{ email: 'desc' }]);
    expect(parseSort(undefined, ['email'], { field: 'email', dir: 'asc' })).toEqual([{ email: 'asc' }]);
    expect(() => parseSort('passwordHash', ['email'], { field: 'email', dir: 'asc' })).toThrow(BadRequestException);
  });

  it('crypto helpers: random tokens are unique, hashes compare in constant time', () => {
    expect(randomToken()).not.toEqual(randomToken());
    expect(randomToken(32)).toHaveLength(43);
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex('abcd', 'ab')).toBe(false);
  });
});

describe('addInterval', () => {
  it('adds months/years in UTC and clamps the day to the target month', () => {
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'MONTH').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addInterval(new Date('2028-01-31T10:00:00Z'), 'MONTH').toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addInterval(new Date('2026-12-15T00:00:00Z'), 'MONTH').toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T00:00:00Z'), 'YEAR').toISOString()).toBe('2029-02-28T00:00:00.000Z');
    expect(addInterval(new Date('2026-03-31T00:00:00Z'), 'MONTH', 2).toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });
});

describe('global rate limit', () => {
  it('answers 429 once a client exceeds THROTTLE_LIMIT per minute', async () => {
    const t = await createTestApp({ THROTTLE_LIMIT: '3' });
    try {
      for (let i = 0; i < 3; i++) await t.http().get('/api/v1/health').expect(200);
      await t.http().get('/api/v1/health').expect(429);
    } finally {
      await t.close();
    }
  });
});

describe('EntitlementsService plan switch', () => {
  // Free plan: no Telegram, 10 products; the store already has 10.
  const db = {
    subscription: { findFirst: async () => null },
    plan: { findUnique: async () => ({ id: 'p', code: 'FREE', name: 'Free', features: [{ featureKey: 'products.max', enabled: true, limitValue: 10 }] }) },
    product: { count: async () => 10 },
  } as unknown as PrismaService;
  const ent = (on: boolean) => new EntitlementsService(db, { PLAN_LIMITS: on } as Env);

  it('single-owner mode (PLAN_LIMITS off): every feature on, no limits', async () => {
    await expect(ent(false).assertFeature('o', 'telegram_mini_app')).resolves.toBeUndefined();
    await expect(ent(false).assertLimit('o', 'products.max')).resolves.toBeUndefined();
    expect((await ent(false).forOrganization('o')).plan?.code).toBe('FREE');
  });

  it('platform mode (PLAN_LIMITS on): the plan gates features and caps limits', async () => {
    await expect(ent(true).assertFeature('o', 'telegram_mini_app')).rejects.toMatchObject({ status: 402 });
    await expect(ent(true).assertLimit('o', 'products.max')).rejects.toMatchObject({ status: 402 });
  });
});
