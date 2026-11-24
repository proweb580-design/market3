import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sign } from '@telegram-apps/init-data-node';
import { SignJWT } from 'jose';
import { SecretBox } from '../src/common/secret-box.js';
import { BotApiError, type BotApi } from '../src/modules/telegram/bot-api.js';
import { InitDataError, verifyInitData } from '../src/modules/telegram/init-data.js';
import { PLATFORM_KID } from '../src/modules/telegram/platform-token.service.js';
import { createTestApp, TEST_DB, type TestCtx } from './helpers.js';

const PLATFORM_BOT = '1111111111:AAplatformBotTokenForTestsOnly_0123456789';
const BRAND_BOT = '2222222222:AAbrandBotTokenForTestsOnly_00000000000000';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const JWT_SECRET = 'jwt-secret-for-tests-0123456789abcdef-xyz';

/** initData signed by the independent reference implementation — not by our own code. */
const initDataFor = (token: string, user: { id: number; first_name?: string; username?: string; language_code?: string }, opts: { authDate?: Date; startParam?: string } = {}) =>
  sign({ user: { first_name: 'Test', ...user }, ...(opts.startParam ? { start_param: opts.startParam } : {}) } as never, token, opts.authDate ?? new Date());

const tgId = () => 100_000_000 + Math.floor(Math.random() * 1_900_000_000);

describe('verifyInitData (against the reference signer)', () => {
  const user = { id: 424242, first_name: 'Ann', username: 'ann' };

  it('accepts genuine data and returns the verified user and start parameter', () => {
    const v = verifyInitData(initDataFor(PLATFORM_BOT, user, { startParam: 'link_abc' }), PLATFORM_BOT, 600);
    expect(v.user).toMatchObject(user);
    expect(v.startParam).toBe('link_abc');
  });

  it.each([
    ['another bot token', () => verifyInitData(initDataFor(BRAND_BOT, user), PLATFORM_BOT, 600)],
    ['a changed user id', () => verifyInitData(initDataFor(PLATFORM_BOT, user).replace('424242', '424243'), PLATFORM_BOT, 600)],
    ['an added field', () => verifyInitData(`${initDataFor(PLATFORM_BOT, user)}&chat_type=private`, PLATFORM_BOT, 600)],
    ['a stale auth_date', () => verifyInitData(initDataFor(PLATFORM_BOT, user, { authDate: new Date(Date.now() - 3_600_000) }), PLATFORM_BOT, 600)],
    ['a future auth_date', () => verifyInitData(initDataFor(PLATFORM_BOT, user, { authDate: new Date(Date.now() + 3_600_000) }), PLATFORM_BOT, 600)],
    ['no hash', () => verifyInitData(initDataFor(PLATFORM_BOT, user).replace(/&?hash=[0-9a-f]+/, ''), PLATFORM_BOT, 600)],
    ['an empty string', () => verifyInitData('', PLATFORM_BOT, 600)],
  ])('rejects %s', (_name, run) => {
    expect(run).toThrow(InitDataError);
  });
});

describe('SecretBox', () => {
  it('round-trips, uses a fresh IV each time, and detects tampering or a wrong key', () => {
    const box = new SecretBox(ENCRYPTION_KEY);
    const a = box.seal('secret-token');
    expect(box.open(a)).toBe('secret-token');
    expect(box.seal('secret-token')).not.toBe(a);
    expect(a).not.toContain('secret-token');
    const [v, iv, tag, ct] = a.split('.');
    const flipped = `${v}.${iv}.${tag}.${ct!.slice(0, -2)}${ct!.endsWith('A') ? 'B' : 'A'}${ct!.slice(-1)}`;
    expect(() => box.open(flipped)).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).open(a)).toThrow();
  });
});

describe.skipIf(!TEST_DB)('Telegram Mini App sign-in, sessions, linking and brand bots', () => {
  let t: TestCtx;
  const bot = {
    getMe: vi.fn<BotApi['getMe']>(),
    setWebhook: vi.fn<BotApi['setWebhook']>(async () => undefined),
    deleteWebhook: vi.fn<BotApi['deleteWebhook']>(async () => undefined),
    setChatMenuButton: vi.fn<BotApi['setChatMenuButton']>(async () => undefined),
    sendMessage: vi.fn<BotApi['sendMessage']>(async () => undefined),
    sendButtons: vi.fn<BotApi['sendButtons']>(async () => 777),
    editButtons: vi.fn<BotApi['editButtons']>(async () => undefined),
    answerCallback: vi.fn<BotApi['answerCallback']>(async () => undefined),
  };
  let store: { id: string; slug: string };

  const auth = (initData: string, slug = store.slug, extra: object = {}) =>
    t.http().post('/api/v1/telegram/auth').send({ initData, store: slug, ...extra });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await createTestApp(
      { JWT_SECRET, ENCRYPTION_KEY, TELEGRAM_BOT_TOKEN: PLATFORM_BOT, PUBLIC_MINI_APP_URL: 'https://mini.example.com', PUBLIC_API_URL: 'https://api.example.com' },
      { botApi: bot },
    );
    store = await t.createOrg(await t.user('store-owner')); // BUSINESS plan → telegram_mini_app on
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => t.close());

  describe('sign-in', () => {
    it('creates a Telegram user and a session; the access token works on the API', async () => {
      const id = tgId();
      const res = await auth(initDataFor(PLATFORM_BOT, { id, first_name: 'Lena', username: 'lena', language_code: 'en' })).expect(201);
      expect(res.body).toMatchObject({ expiresIn: 900, store: { slug: store.slug }, user: { displayName: 'Lena', locale: 'en' } });

      const me = await t.http().get('/api/v1/auth/me').set(bearer(res.body.accessToken)).expect(200);
      expect(me.body).toMatchObject({ email: null, telegramAccount: { username: 'lena' } });
      const account = await t.db.telegramAccount.findUniqueOrThrow({ where: { telegramId: BigInt(id) } });
      expect(account.userId).toBe(me.body.id);
      const session = await t.db.session.findFirstOrThrow({ where: { userId: me.body.id } });
      expect(session).toMatchObject({ kind: 'TELEGRAM', organizationId: store.id });
      expect(session.refreshTokenHash).not.toBe(res.body.refreshToken);

      // Second launch: same person, same platform user.
      const again = await auth(initDataFor(PLATFORM_BOT, { id, first_name: 'Lena' })).expect(201);
      expect(again.body.user.id).toBe(me.body.id);
    });

    it('never takes the Telegram identity from the request body', async () => {
      await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), store.slug, { user: { id: 1 } }).expect(400);
      await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), store.slug, { telegramId: 1 }).expect(400);
    });

    it('rejects forged, foreign-bot, stale and replayed data with one generic 401', async () => {
      const forged = initDataFor(PLATFORM_BOT, { id: 777 }).replace('777', '778');
      const messages = await Promise.all(
        [forged, initDataFor('9999:AAsomeOtherBotToken_______________________', { id: 1 }), initDataFor(PLATFORM_BOT, { id: 2 }, { authDate: new Date(Date.now() - 3_600_000) })].map(
          async (d) => (await auth(d).expect(401)).body.message,
        ),
      );
      expect(new Set(messages)).toEqual(new Set(['Invalid Telegram data']));

      const once = initDataFor(PLATFORM_BOT, { id: tgId() });
      await auth(once).expect(201);
      expect((await auth(once).expect(401)).body.message).toMatch(/already used/);
    });

    it('checks the store: unknown 404, suspended 403, plan without Mini App 402', async () => {
      await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), 'no-such-store').expect(404);

      const free = await t.createOrg(await t.user('free-owner'), undefined, 'FREE');
      const r = await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), free.slug).expect(402);
      expect(r.body.details).toMatchObject({ feature: 'telegram_mini_app', plan: 'FREE' });

      const susp = await t.createOrg(await t.user('susp-owner'));
      await t.db.organization.update({ where: { id: susp.id }, data: { status: 'SUSPENDED' } });
      await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), susp.slug).expect(403);
    });

    it('refuses blocked users, also on their existing tokens', async () => {
      const id = tgId();
      const first = (await auth(initDataFor(PLATFORM_BOT, { id })).expect(201)).body;
      await t.db.user.update({ where: { id: first.user.id }, data: { status: 'BLOCKED' } });
      await t.http().get('/api/v1/auth/me').set(bearer(first.accessToken)).expect(403);
      // A new launch (Telegram signs a fresh payload each time) is refused too.
      await auth(initDataFor(PLATFORM_BOT, { id }, { authDate: new Date(Date.now() - 5000) })).expect(403);
    });
  });

  describe('session tokens', () => {
    it('refresh rotates the token; the old one stops working', async () => {
      const s = (await auth(initDataFor(PLATFORM_BOT, { id: tgId() })).expect(201)).body;
      const next = (await t.http().post('/api/v1/telegram/refresh').send({ refreshToken: s.refreshToken }).expect(200)).body;
      expect(next.refreshToken).not.toBe(s.refreshToken);
      await t.http().get('/api/v1/auth/me').set(bearer(next.accessToken)).expect(200);
      await t.http().post('/api/v1/telegram/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('logout revokes the session: access and refresh both stop', async () => {
      const s = (await auth(initDataFor(PLATFORM_BOT, { id: tgId() })).expect(201)).body;
      await t.http().post('/api/v1/auth/logout').set(bearer(s.accessToken)).expect(204);
      await t.http().get('/api/v1/auth/me').set(bearer(s.accessToken)).expect(401);
      await t.http().post('/api/v1/telegram/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    });

    it('rejects platform-looking tokens signed with another secret, and expired ones', async () => {
      const s = (await auth(initDataFor(PLATFORM_BOT, { id: tgId() })).expect(201)).body;
      const me = (await t.http().get('/api/v1/auth/me').set(bearer(s.accessToken)).expect(200)).body;
      const session = await t.db.session.findFirstOrThrow({ where: { userId: me.id } });
      const forge = (secret: string, exp: string | number) =>
        new SignJWT({ sid: session.id }).setProtectedHeader({ alg: 'HS256', kid: PLATFORM_KID }).setSubject(me.id).setIssuer('platform-api').setAudience('platform').setExpirationTime(exp).sign(new TextEncoder().encode(secret));
      await t.http().get('/api/v1/auth/me').set(bearer(await forge('another-secret-that-is-long-enough-123', '10m'))).expect(401);
      await t.http().get('/api/v1/auth/me').set(bearer(await forge(JWT_SECRET, Math.floor(Date.now() / 1000) - 10))).expect(401);
      await t.http().get('/api/v1/auth/me').set(bearer(await forge(JWT_SECRET, '10m'))).expect(200); // control: a correct one passes
    });
  });

  describe('linking web and Telegram accounts', () => {
    it('a one-time code from the web account links the Telegram account to it', async () => {
      const web = await t.user('web-linker');
      const { startParam } = (await web.post('/telegram/link-code').expect(201)).body;
      expect(startParam).toMatch(/^link_[A-Za-z0-9_-]{22}$/);

      const id = tgId();
      const s = (await auth(initDataFor(PLATFORM_BOT, { id, username: 'linked' }, { startParam })).expect(201)).body;
      expect(s.user.id).toBe(web.id);
      expect((await web.get('/auth/me').expect(200)).body.telegramAccount).toMatchObject({ username: 'linked' });

      // Single use, and a linked account can't ask for another code.
      await auth(initDataFor(PLATFORM_BOT, { id }, { startParam })).expect(400);
      await web.post('/telegram/link-code').expect(409);
    });

    it('will not move a Telegram account that already belongs to someone else', async () => {
      const id = tgId();
      await auth(initDataFor(PLATFORM_BOT, { id })).expect(201); // Telegram-only user owns it
      const web = await t.user('web-other');
      const { startParam } = (await web.post('/telegram/link-code').expect(201)).body;
      await auth(initDataFor(PLATFORM_BOT, { id }, { startParam })).expect(409);
    });

    it('unlinking needs another way to sign in', async () => {
      const web = await t.user('web-unlink');
      const { startParam } = (await web.post('/telegram/link-code').expect(201)).body;
      const s = (await auth(initDataFor(PLATFORM_BOT, { id: tgId() }, { startParam })).expect(201)).body;
      await web.del('/users/me/telegram').expect(204);
      await t.http().get('/api/v1/auth/me').set(bearer(s.accessToken)).expect(401); // Telegram sessions closed

      const tgOnly = (await auth(initDataFor(PLATFORM_BOT, { id: tgId() })).expect(201)).body;
      await t.http().delete('/api/v1/users/me/telegram').set(bearer(tgOnly.accessToken)).expect(409);
    });
  });

  describe("a brand's own bot", () => {
    it('connects with a validated token stored encrypted, registers webhook and menu button, never returns the token', async () => {
      const owner = await t.user('bot-owner');
      const org = await t.createOrg(owner);
      bot.getMe.mockResolvedValueOnce({ id: 2222222222, username: 'brand_bot', first_name: 'Brand' });

      const res = await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: BRAND_BOT }).expect(200);
      expect(res.body).toMatchObject({ connected: true, bot: { username: 'brand_bot', webhook: true, menuButton: true } });
      expect(JSON.stringify(res.body)).not.toContain(BRAND_BOT);
      expect(bot.setWebhook).toHaveBeenCalledWith(BRAND_BOT, expect.stringMatching(/^https:\/\/api\.example\.com\/api\/v1\/telegram\/webhook\/[0-9a-f-]{36}$/), expect.any(String));
      expect(bot.setChatMenuButton).toHaveBeenCalledWith(BRAND_BOT, 'Open store', `https://mini.example.com/${org.slug}`);

      const row = await t.db.integration.findFirstOrThrow({ where: { organizationId: org.id } });
      expect(row.secretEncrypted).not.toContain(BRAND_BOT.split(':')[1]);
      expect(JSON.parse(new SecretBox(ENCRYPTION_KEY).open(row.secretEncrypted!)).botToken).toBe(BRAND_BOT);
      expect((await owner.get(`/organizations/${org.id}/integrations/telegram`).expect(200)).body.connected).toBe(true);

      // Now this store only trusts initData from its own bot.
      await auth(initDataFor(PLATFORM_BOT, { id: tgId() }), org.slug).expect(401);
      await auth(initDataFor(BRAND_BOT, { id: tgId() }), org.slug).expect(201);
    });

    it('validates the token with Telegram, keeps one bot per store, and respects role and plan', async () => {
      const owner = await t.user('bot-owner2');
      const org = await t.createOrg(owner);
      bot.getMe.mockRejectedValueOnce(new BotApiError('Unauthorized'));
      await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: BRAND_BOT }).expect(422);
      bot.getMe.mockResolvedValueOnce({ id: 2222222222, username: 'brand_bot', first_name: 'Brand' });
      await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: BRAND_BOT }).expect(409); // used by another store
      await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: 'not-a-token' }).expect(400);

      const staff = await t.user('bot-staff');
      await t.addMember(org.id, staff, 'ORG_STAFF');
      await staff.put(`/organizations/${org.id}/integrations/telegram`, { botToken: BRAND_BOT }).expect(403);
      const freeOwner = await t.user('bot-free');
      const free = await t.createOrg(freeOwner, undefined, 'FREE');
      await freeOwner.put(`/organizations/${free.id}/integrations/telegram`, { botToken: BRAND_BOT }).expect(402);
    });

    it('answers /start only for requests carrying the webhook secret', async () => {
      const owner = await t.user('bot-owner3');
      const org = await t.createOrg(owner);
      const token = '3333333333:AAthirdBotTokenForTestsOnly_00000000000000';
      bot.getMe.mockResolvedValueOnce({ id: 3333333333, username: 'third_bot', first_name: 'Third' });
      await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: token }).expect(200);
      const [, url, secret] = bot.setWebhook.mock.calls[0]!;
      const path = new URL(url).pathname;
      const update = { update_id: 1, message: { message_id: 1, text: '/start', chat: { id: 555, type: 'private' } } };

      await t.http().post(path).send(update).expect(401);
      await t.http().post(path).set('X-Telegram-Bot-Api-Secret-Token', 'wrong').send(update).expect(401);
      expect(bot.sendMessage).not.toHaveBeenCalled();
      await t.http().post(path).set('X-Telegram-Bot-Api-Secret-Token', secret).send(update).expect(200, { ok: true });
      expect(bot.sendMessage).toHaveBeenCalledWith(token, 555, expect.stringContaining(org.slug.replace(/^org-/, 'Org org-')), { text: 'Open store', webAppUrl: `https://mini.example.com/${org.slug}` });
      await t.http().post(`/api/v1/telegram/webhook/${randomUUID()}`).set('X-Telegram-Bot-Api-Secret-Token', secret).send(update).expect(404);

      await owner.del(`/organizations/${org.id}/integrations/telegram`).expect(204);
      expect(bot.deleteWebhook).toHaveBeenCalledWith(token);
      expect((await owner.get(`/organizations/${org.id}/integrations/telegram`).expect(200)).body).toMatchObject({ connected: false, usingPlatformBot: true });
    });
  });
  describe('support: form, tickets and the support bot', () => {
    const SUPPORT_BOT = '3333333333:AAsupportBotTokenForTestsOnly_000000000000';
    const msg = { name: 'Ann', email: 'ann@example.com', topic: 'delivery', orderNumber: '1042', message: 'Where is my parcel? <b>hi</b>' };
    const send = (slug: string, body: object = msg) => t.http().post(`/api/v1/storefront/${slug}/support`).send(body);
    const hook = (id: string, secret: string, update: object) =>
      t.http().post(`/api/v1/support/webhook/${id}`).set('X-Telegram-Bot-Api-Secret-Token', secret).send(update);

    it('saves every ticket for the dashboard; without a group it DMs team members who linked Telegram', async () => {
      const owner = await t.user('support-owner');
      const org = await t.createOrg(owner);
      await send(org.slug).expect(200); // nobody to notify — still saved
      expect(bot.sendMessage).not.toHaveBeenCalled();

      const { startParam } = (await owner.post('/telegram/link-code').expect(201)).body;
      const id = tgId();
      await auth(initDataFor(PLATFORM_BOT, { id }, { startParam }), org.slug).expect(201);
      await send(org.slug).expect(200);
      const [token, chat, text] = bot.sendMessage.mock.calls[0]!;
      expect([token, chat]).toEqual([PLATFORM_BOT, id]);
      for (const part of ['Доставка', 'Ann <ann@example.com>', 'Заказ: 1042', 'Where is my parcel? <b>hi</b>', 'Новое']) expect(text).toContain(part);

      const list = (await owner.get(`/organizations/${org.id}/support/tickets`).expect(200)).body;
      expect(list).toMatchObject({ total: 2, open: 2, items: [{ status: 'NEW', email: 'ann@example.com', topic: 'delivery' }, {}] });
      expect(list.items[0]).not.toHaveProperty('telegramChatId');

      await send(org.slug, { ...msg, email: 'nope', extra: 1 }).expect(400);
      await send('no-such-store').expect(404);
      const stranger = await t.user('support-stranger');
      await stranger.get(`/organizations/${org.id}/support/tickets`).expect(403);
    });

    it('binds a group with the one-time code, posts tickets there, and the buttons and dashboard move them through statuses', async () => {
      const owner = await t.user('support-bot-owner');
      const org = await t.createOrg(owner);
      bot.getMe.mockResolvedValueOnce({ id: 3333333333, username: 'help_bot', first_name: 'Help' });
      const connected = (await owner.put(`/organizations/${org.id}/integrations/telegram-support`, { botToken: SUPPORT_BOT }).expect(200)).body;
      expect(JSON.stringify(connected)).not.toContain(SUPPORT_BOT);
      const code: string = connected.bot.bindCode;
      expect(bot.setWebhook).toHaveBeenCalledWith(SUPPORT_BOT, expect.stringMatching(/\/api\/v1\/support\/webhook\/[0-9a-f-]{36}$/), expect.any(String), ['message', 'callback_query']);
      const [, url, secret] = bot.setWebhook.mock.calls[0]!;
      const integrationId = url.split('/').pop()!;

      // The same bot can't double as the store bot.
      bot.getMe.mockResolvedValueOnce({ id: 3333333333, username: 'help_bot', first_name: 'Help' });
      await owner.put(`/organizations/${org.id}/integrations/telegram`, { botToken: SUPPORT_BOT }).expect(409);

      const GROUP = -1001234567890;
      await hook(integrationId, 'wrong-secret', {}).expect(401);
      await hook(integrationId, secret, { message: { text: '/bind@help_bot not-the-code', chat: { id: GROUP, type: 'supergroup', title: 'Team' } } }).expect(200);
      expect((await owner.get(`/organizations/${org.id}/integrations/telegram-support`).expect(200)).body.bot.chatId).toBeNull();
      await hook(integrationId, secret, { message: { text: `/bind@help_bot ${code}`, chat: { id: GROUP, type: 'supergroup', title: 'Team' } } }).expect(200);
      expect((await owner.get(`/organizations/${org.id}/integrations/telegram-support`).expect(200)).body.bot).toMatchObject({ chatId: GROUP, chatTitle: 'Team', bindCode: null });

      await send(org.slug).expect(200);
      const [token, chat, text, buttons] = bot.sendButtons.mock.calls[0]!;
      expect([token, chat]).toEqual([SUPPORT_BOT, GROUP]);
      expect(text).toContain('Ann <ann@example.com>');
      const ticket = (await owner.get(`/organizations/${org.id}/support/tickets`).expect(200)).body.items[0];
      expect(buttons.map((b) => b.data)).toEqual([`IN_PROGRESS:${ticket.id}`, `RESOLVED:${ticket.id}`]);

      // A button pressed outside the bound group does nothing.
      await hook(integrationId, secret, { callback_query: { id: 'cb0', data: `RESOLVED:${ticket.id}`, from: { first_name: 'Eve' }, message: { chat: { id: 42 } } } }).expect(200);
      expect(bot.answerCallback).toHaveBeenLastCalledWith(SUPPORT_BOT, 'cb0', 'Обращение не найдено');

      await hook(integrationId, secret, { callback_query: { id: 'cb1', data: `IN_PROGRESS:${ticket.id}`, from: { first_name: 'Max' }, message: { chat: { id: GROUP } } } }).expect(200);
      expect(bot.editButtons).toHaveBeenLastCalledWith(SUPPORT_BOT, GROUP, 777, expect.stringContaining('В работе — Max'), [{ text: '✅ Решено', data: `RESOLVED:${ticket.id}` }]);
      expect((await owner.get(`/organizations/${org.id}/support/tickets?status=IN_PROGRESS`).expect(200)).body.items[0]).toMatchObject({ id: ticket.id, assignee: 'Max' });

      const done = (await owner.patch(`/organizations/${org.id}/support/tickets/${ticket.id}`, { status: 'RESOLVED' }).expect(200)).body;
      expect(done).toMatchObject({ status: 'RESOLVED', assignee: 'Max' });
      expect(done.resolvedAt).toBeTruthy();
      expect(bot.editButtons).toHaveBeenLastCalledWith(SUPPORT_BOT, GROUP, 777, expect.stringContaining('Решено — Max'), [{ text: '↩️ Открыть снова', data: `NEW:${ticket.id}` }]);
      expect((await owner.get(`/organizations/${org.id}/support/tickets`).expect(200)).body.open).toBe(0);

      await owner.del(`/organizations/${org.id}/integrations/telegram-support`).expect(204);
      expect(bot.deleteWebhook).toHaveBeenCalledWith(SUPPORT_BOT);
    });
  });
});
