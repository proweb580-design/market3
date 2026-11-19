// Local stand-ins for Supabase (sign-in + storage) and Stripe, so end-to-end tests run the REAL platform code
// without touching any real account. Not a faithful clone: only the calls this platform makes.
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { PORTS, URLS } from './env.mjs';

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });

const CORS = {
  'Access-Control-Allow-Origin': URLS.web,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-upsert,cache-control,accept',
  'Access-Control-Expose-Headers': 'x-supabase-api-version',
};

// ───────────────────────── fake Supabase ─────────────────────────

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'e2e-key', alg: 'ES256', use: 'sig' };
const users = new Map(); // email → { id, password }
const refresh = new Map(); // refresh token → { user, sessionId }
const objects = new Map(); // storage path → { bytes, contentType }
const uploadTokens = new Map(); // token → path

const userJson = (u) => ({
  id: u.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: u.email,
  email_confirmed_at: new Date().toISOString(),
  phone: '',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { email_verified: true },
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

async function session(u, sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const access = await new SignJWT({ email: u.email, session_id: sessionId, role: 'authenticated', aal: 'aal1', is_anonymous: false, user_metadata: { email_verified: true } })
    .setProtectedHeader({ alg: 'ES256', kid: 'e2e-key' })
    .setSubject(u.id)
    .setIssuer(`${URLS.supabase}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
  const refreshToken = randomBytes(12).toString('hex');
  refresh.set(refreshToken, { user: u, sessionId });
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refreshToken, user: userJson(u) };
}

const authError = (res, status, code, message) => json(res, status, { code: status, error_code: code, error: code, error_description: message, msg: message, message }, CORS);

async function supabase(req, res) {
  const url = new URL(req.url, URLS.supabase);
  const path = url.pathname;
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();

  if (path === '/auth/v1/.well-known/jwks.json') return json(res, 200, { keys: [jwk] }, CORS);

  if (path === '/auth/v1/signup' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const email = String(body.email ?? '').toLowerCase();
    console.log('signup', email, users.has(email) ? '(already exists)' : '(new)');
    if (!email || !body.password) return authError(res, 422, 'validation_failed', 'Email and password are required');
    if (String(body.password).length < 6) return authError(res, 422, 'weak_password', 'Password should be at least 6 characters');
    if (users.has(email)) return authError(res, 422, 'user_already_exists', 'User already registered');
    const user = { id: randomUUID(), email, password: body.password };
    users.set(email, user);
    return json(res, 200, await session(user), CORS); // email confirmation is "off" here: the user is signed in at once
  }

  if (path === '/auth/v1/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    if (grant === 'password') {
      const user = users.get(String(body.email ?? '').toLowerCase());
      if (!user || user.password !== body.password) return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      return json(res, 200, await session(user), CORS);
    }
    if (grant === 'refresh_token') {
      const found = refresh.get(body.refresh_token);
      if (!found) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token');
      refresh.delete(body.refresh_token);
      return json(res, 200, await session(found.user, found.sessionId), CORS);
    }
    return authError(res, 400, 'unsupported_grant_type', 'Unsupported grant type');
  }

  if (path === '/auth/v1/user') {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const payload = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) : null;
    const user = payload && [...users.values()].find((u) => u.id === payload.sub);
    if (!user) return authError(res, 401, 'bad_jwt', 'Invalid token');
    if (req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      if (body.password) user.password = body.password;
    }
    return json(res, 200, userJson(user), CORS);
  }
  if (path === '/auth/v1/logout') return res.writeHead(204, CORS).end();
  if (path === '/auth/v1/recover') return json(res, 200, {}, CORS);

  // ── storage ──
  if (path.startsWith('/storage/v1/bucket')) return json(res, 200, { name: 'media' }, CORS);

  const sign = /^\/storage\/v1\/object\/upload\/sign\/media\/(.+)$/.exec(path);
  if (sign) {
    const key = decodeURIComponent(sign[1]);
    if (req.method === 'POST') {
      const token = `tok_${randomBytes(8).toString('hex')}`;
      uploadTokens.set(token, key);
      return json(res, 200, { url: `/object/upload/sign/media/${sign[1]}?token=${token}` }, CORS);
    }
    if (req.method === 'PUT') {
      if (uploadTokens.get(url.searchParams.get('token')) !== key) return json(res, 403, { error: 'invalid token' }, CORS);
      uploadTokens.delete(url.searchParams.get('token'));
      const body = await readBody(req);
      const type = String(req.headers['content-type'] ?? '');
      let bytes = body;
      let contentType = type;
      const boundary = /boundary=(.+)$/.exec(type)?.[1];
      if (boundary) {
        // supabase-js uploads a multipart form: take the file part (the one that carries its own Content-Type)
        for (const part of body.toString('latin1').split(`--${boundary}`)) {
          const split = part.indexOf('\r\n\r\n');
          if (split < 0) continue;
          const head = part.slice(0, split);
          const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1];
          if (!ct) continue;
          contentType = ct.trim();
          bytes = Buffer.from(part.slice(split + 4, part.length - 2), 'latin1');
        }
      }
      objects.set(key, { bytes, contentType });
      return json(res, 200, { Key: `media/${key}` }, CORS);
    }
  }

  const pub = /^\/storage\/v1\/object\/public\/media\/(.+)$/.exec(path);
  if (pub) {
    const object = objects.get(decodeURIComponent(pub[1]));
    if (!object) return json(res, 404, { error: 'not_found' }, CORS);
    res.writeHead(200, { ...CORS, 'Content-Type': object.contentType, 'Content-Length': object.bytes.length });
    return res.end(req.method === 'HEAD' ? undefined : object.bytes);
  }
  const del = /^\/storage\/v1\/object\/media\/(.+)$/.exec(path);
  if (del && req.method === 'DELETE') {
    objects.delete(decodeURIComponent(del[1]));
    return json(res, 200, {}, CORS);
  }

  json(res, 404, { error: 'not implemented in the e2e fake', path }, CORS);
}

// ───────────────────────── fake Stripe ─────────────────────────

const sessions = new Map();

/** Stripe SDK bodies are form-encoded with bracket keys; we only need a handful of them. */
const form = (buffer) => Object.fromEntries(new URLSearchParams(buffer.toString()));

async function stripe(req, res) {
  const url = new URL(req.url, URLS.stripe);
  const path = url.pathname;

  if (path === '/v1/checkout/sessions' && req.method === 'POST') {
    const f = form(await readBody(req));
    const id = `cs_test_${randomBytes(12).toString('hex')}`;
    sessions.set(id, {
      id,
      object: 'checkout.session',
      url: `${URLS.stripe}/c/pay/${id}`,
      expires_at: Number(f.expires_at),
      amount_total: Number(f['line_items[0][price_data][unit_amount]']),
      currency: f['line_items[0][price_data][currency]'],
      payment_status: 'unpaid',
      status: 'open',
      payment_intent: null,
      client_reference_id: f.client_reference_id,
      success_url: f.success_url,
      cancel_url: f.cancel_url,
    });
    return json(res, 200, sessions.get(id));
  }
  const get = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(path);
  if (get) return sessions.has(get[1]) ? json(res, 200, sessions.get(get[1])) : json(res, 404, { error: { message: 'No such session' } });
  if (path === '/v1/refunds' && req.method === 'POST') {
    const f = form(await readBody(req));
    return json(res, 200, { id: `re_${randomBytes(6).toString('hex')}`, object: 'refund', status: 'succeeded', amount: Number(f.amount), currency: 'usd', payment_intent: f.payment_intent });
  }

  // What a shopper sees after the redirect (a stand-in for Stripe's hosted page).
  const page = /^\/c\/pay\/([^/]+)$/.exec(path);
  if (page) {
    const s = sessions.get(page[1]);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Fake Stripe Checkout</title><h1>Fake Stripe Checkout</h1><p id="amount">${s ? s.amount_total : 'unknown'} ${s?.currency ?? ''}</p><p id="session">${page[1]}</p>`);
  }

  // ── test control ──
  const pay = /^\/__control\/pay\/([^/]+)$/.exec(path);
  if (pay && req.method === 'POST') {
    const s = sessions.get(pay[1]);
    if (!s) return json(res, 404, {});
    Object.assign(s, { payment_status: 'paid', status: 'complete', payment_intent: `pi_${randomBytes(8).toString('hex')}` });
    return json(res, 200, s);
  }
  if (path === '/__control/sessions') return json(res, 200, [...sessions.values()]);
  json(res, 404, { error: { message: `fake stripe: ${req.method} ${path}` } });
}

const start = (port, handler, name) =>
  new Promise((resolve) => createServer((req, res) => handler(req, res).catch((e) => { console.error(name, e); json(res, 500, { error: String(e) }); })).listen(port, () => { console.log(`${name} on ${port}`); resolve(); }));

await start(PORTS.supabase, supabase, 'fake-supabase');
await start(PORTS.stripe, stripe, 'fake-stripe');
