import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC, MEMBER_ONLY, OPTIONAL_AUTH, PERMISSIONS_META, USER_ONLY } from '../src/common/decorators.js';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ENV, parseEnv } from '../src/config/env.js';
import { setupApp } from '../src/setup.js';

describe('API bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
      .overrideProvider(ENV)
      .useValue(
        parseEnv({
          NODE_ENV: 'test',
          CORS_ORIGINS: 'http://localhost:3000',
          // Deliberately unreachable: these tests cover the API without a database.
          DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
        }),
      )
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(() => app.close());

  it('serves GET /api/v1/health', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('publishes the OpenAPI document with every module and its body/query schemas', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const paths = res.body.paths as Record<string, Record<string, { requestBody?: unknown; parameters?: { name: string }[] }>>;
    for (const p of [
      '/api/v1/health',
      '/api/v1/auth/me',
      '/api/v1/profiles/me',
      '/api/v1/organizations/{orgId}/members',
      '/api/v1/organizations/{orgId}/api-keys',
      '/api/v1/roles',
      '/api/v1/admin/users',
    ]) {
      expect(paths, p).toHaveProperty([p]);
    }
    expect(paths['/api/v1/organizations'].post.requestBody).toBeDefined();
    expect(paths['/api/v1/admin/users'].get.parameters!.map((x) => x.name)).toEqual(expect.arrayContaining(['q', 'status', 'page', 'pageSize', 'sort']));
    expect(Object.keys(paths).length).toBeGreaterThan(40);
  });

  it('every route declares an access rule (@Public, @UserOnly, @MemberOnly or @RequirePermissions)', () => {
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    const unprotected: string[] = [];
    let routes = 0;
    for (const wrapper of discovery.getControllers()) {
      const proto = wrapper.metatype?.prototype as Record<string, unknown> | undefined;
      if (!proto) continue;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function' || Reflect.getMetadata('path', handler) === undefined) continue;
        routes += 1;
        const ruled = [IS_PUBLIC, OPTIONAL_AUTH, USER_ONLY, MEMBER_ONLY, PERMISSIONS_META].some((k) => reflector.getAllAndOverride(k, [handler, wrapper.metatype!]));
        if (!ruled) unprotected.push(`${wrapper.metatype!.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThan(40);
    expect(unprotected).toEqual([]);
  });

  it('allows only configured CORS origins', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const evil = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reports not-ready (503) without leaking details when the database is down', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body).toMatchObject({ statusCode: 503, details: { database: 'down' } });
    expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|nobody|ECONNREFUSED/);
  });
});

describe('parseEnv', () => {
  it('refuses to start without CORS_ORIGINS or DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'postgresql://x' })).toThrow(/CORS_ORIGINS/);
    expect(() => parseEnv({ CORS_ORIGINS: 'http://a' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ CORS_ORIGINS: 'http://a', DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('treats blank values as unset and keeps Stripe live keys out of non-production', () => {
    const base = { NODE_ENV: 'test', CORS_ORIGINS: 'http://a', DATABASE_URL: 'postgresql://x' };
    expect(parseEnv({ ...base, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }).STRIPE_SECRET_KEY).toBeUndefined();
    expect(() => parseEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_abc' })).toThrow(/live keys/);
    expect(() => parseEnv({ ...base, STRIPE_SECRET_KEY: 'pk_test_abc' })).toThrow(/STRIPE_SECRET_KEY/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', SUPABASE_URL: 'https://p.supabase.co', STRIPE_SECRET_KEY: 'sk_live_abc' }).STRIPE_SECRET_KEY).toBe('sk_live_abc');
  });
});
