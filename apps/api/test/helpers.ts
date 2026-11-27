import 'reflect-metadata';
import { OBJECT_STORAGE, type ObjectStorage } from '../src/modules/media/object-storage.js';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { type INestApplication, Controller, Get } from '@nestjs/common';
import { loadEnv } from '../src/config/load-env.js';
import { AppModule } from '../src/app.module.js';
import { ENV, parseEnv } from '../src/config/env.js';
import { setupApp } from '../src/setup.js';
import { createPrismaClient, type Db } from '../src/infra/prisma/create-client.js';
import { JwtVerifier, TOKEN_VERIFIER } from '../src/modules/auth/token-verifier.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../src/modules/billing/payments/payment-provider.js';
import { BOT_API, type BotApi } from '../src/modules/telegram/bot-api.js';

loadEnv();
export const TEST_DB = process.env.TEST_DATABASE_URL;

export const ISSUER = 'https://test-project.supabase.co/auth/v1';
export const AUDIENCE = 'authenticated';

/** Deliberately unprotected route: proves the guard stack fails closed for undeclared routes. */
@Controller('naked')
class NakedController {
  @Get()
  naked() {
    return 'should never be served';
  }
}

export interface TokenOptions {
  sub?: string;
  email?: string | null;
  emailVerified?: boolean;
  sessionId?: string | null;
  audience?: string;
  issuer?: string;
  expiresAt?: number;
  anonymous?: boolean;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  sub: string;
  sessionId: string;
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  patch(path: string, body?: object): request.Test;
  put(path: string, body?: object): request.Test;
  del(path: string): request.Test;
}

export async function createTestApp(envOverrides: Record<string, string> = {}, options: { paymentProvider?: PaymentProvider; botApi?: BotApi; storage?: ObjectStorage } = {}) {
  const keys = await generateKeyPair('ES256');
  const verifier = new JwtVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: async () => keys.publicKey });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule], controllers: [NakedController] })
    .overrideProvider(ENV)
    .useValue(
      parseEnv({
        NODE_ENV: 'test',
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: TEST_DB || 'postgresql://nobody:nothing@127.0.0.1:1/none',
        THROTTLE_LIMIT: '100000',
        PLAN_LIMITS: 'true',
        ...envOverrides,
      }),
    )
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(verifier)
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(options.paymentProvider ?? null)
    .overrideProvider(OBJECT_STORAGE)
    .useValue(options.storage ?? null)
    .overrideProvider(BOT_API)
    .useValue(options.botApi ?? { getMe: () => Promise.reject(new Error('no Bot API in tests')) })
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({ rawBody: true });
  setupApp(app);
  await app.init();

  const http = () => request(app.getHttpServer());
  const db: Db = createPrismaClient(TEST_DB || 'postgresql://nobody:nothing@127.0.0.1:1/none');

  async function sign(o: TokenOptions = {}) {
    const claims: Record<string, unknown> = { user_metadata: { email_verified: o.emailVerified ?? true } };
    if (o.email !== null) claims.email = o.email;
    if (o.sessionId !== null) claims.session_id = o.sessionId ?? randomUUID();
    if (o.anonymous) claims.is_anonymous = true;
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setSubject(o.sub ?? randomUUID())
      .setIssuer(o.issuer ?? ISSUER)
      .setAudience(o.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(o.expiresAt ?? Math.floor(Date.now() / 1000) + 3600)
      .sign(keys.privateKey);
  }

  /** Signs a user in (first call creates the platform user) and returns an authenticated request helper. */
  async function user(name = 'user'): Promise<TestUser> {
    const email = `${name}-${randomUUID().slice(0, 8)}@example.com`;
    const sub = randomUUID();
    const sessionId = randomUUID();
    const token = await sign({ sub, email, sessionId });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    const me = await auth(http().get('/api/v1/auth/me')).expect(200);
    return {
      id: me.body.id,
      email,
      token,
      sub,
      sessionId,
      get: (p) => auth(http().get(`/api/v1${p}`)),
      post: (p, b) => auth(http().post(`/api/v1${p}`)).send(b ?? {}),
      patch: (p, b) => auth(http().patch(`/api/v1${p}`)).send(b ?? {}),
      put: (p, b) => auth(http().put(`/api/v1${p}`)).send(b ?? {}),
      del: (p) => auth(http().delete(`/api/v1${p}`)),
    };
  }

  const systemRole = (key: string) => db.role.findFirstOrThrow({ where: { key, organizationId: null } });

  async function grantPlatformRole(userId: string, roleKey: string) {
    const role = await systemRole(roleKey);
    await db.userRole.create({ data: { userId, roleId: role.id } });
  }

  /** Creates an organization through the API (it starts on FREE), then — unless `plan` is FREE — moves it to `plan`
   *  directly in the DB, so non-billing tests aren't limited by Free-plan quotas. */
  async function createOrg(owner: TestUser, slug = `org-${randomUUID().slice(0, 8)}`, plan = 'BUSINESS') {
    const res = await owner.post('/organizations', { slug, name: `Org ${slug}` }).expect(201);
    if (plan !== 'FREE') {
      const target = await db.plan.findUniqueOrThrow({ where: { code: plan } });
      await db.subscription.updateMany({ where: { organizationId: res.body.id, status: 'ACTIVE' }, data: { planId: target.id } });
    }
    return res.body as { id: string; slug: string };
  }

  /** Adds `member` to the organization with a system role, bypassing the invitation flow. */
  async function addMember(orgId: string, member: TestUser, roleKey: string) {
    const role = await systemRole(roleKey);
    return db.organizationMember.create({ data: { organizationId: orgId, userId: member.id, roleId: role.id } });
  }

  return { app, http, db, sign, user, systemRole, grantPlatformRole, createOrg, addMember, close: async () => { await app.close(); await db.$disconnect(); } };
}

export type TestCtx = Awaited<ReturnType<typeof createTestApp>>;
