import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomToken, safeEqualHex, sha256 } from '../../common/crypto.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { SecretBox } from '../../common/secret-box.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { BOT_API, type BotApi, BotApiError } from './bot-api.js';
import { InitDataError, verifyInitData, type TelegramWebAppUser } from './init-data.js';
import { ACCESS_TTL_SEC, PlatformTokenService } from './platform-token.service.js';

const SESSION_TTL_MS = 30 * 86_400_000;
const LINK_CODE_TTL_MS = 10 * 60_000;
const LINK_PREFIX = 'link_';

interface BotSecrets {
  botToken: string;
  webhookSecret: string;
}

const isHttps = (url?: string) => !!url && url.startsWith('https://');
const trimSlash = (url: string) => url.replace(/\/+$/, '');

@Injectable()
export class TelegramService {
  private readonly logger = new Logger('Telegram');
  private readonly box: SecretBox | null;

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: PlatformTokenService,
    private readonly entitlements: EntitlementsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(BOT_API) private readonly bot: BotApi,
  ) {
    this.box = env.ENCRYPTION_KEY ? new SecretBox(env.ENCRYPTION_KEY) : null;
  }

  private storeUrl(slug: string) {
    return `${trimSlash(this.env.PUBLIC_MINI_APP_URL)}/${slug}`;
  }

  // ── bot tokens ──

  private async integration(organizationId: string) {
    return this.db.integration.findUnique({
      where: { organizationId_kind_provider: { organizationId, kind: 'TELEGRAM_BOT', provider: 'telegram' } },
    });
  }

  private openSecrets(envelope: string | null): BotSecrets {
    if (!this.box || !envelope) throw new ServiceUnavailableException('Bot credentials are unavailable (ENCRYPTION_KEY)');
    return JSON.parse(this.box.open(envelope)) as BotSecrets;
  }

  /** The brand's own bot if connected, otherwise the platform bot. */
  private async botTokenFor(organizationId: string) {
    const own = await this.integration(organizationId);
    if (own?.status === 'ACTIVE') return this.openSecrets(own.secretEncrypted).botToken;
    if (this.env.TELEGRAM_BOT_TOKEN) return this.env.TELEGRAM_BOT_TOKEN;
    throw new ServiceUnavailableException('Telegram is not configured for this store');
  }

  // ── team notifications ──

  /**
   * Fallback delivery for support tickets when no support group is bound: a direct message from the store bot
   * to every active member with a linked Telegram account. Best effort — the ticket is already saved.
   */
  async notifyTeam(organizationId: string, text: string) {
    const members = await this.db.organizationMember.findMany({
      where: { organizationId, status: 'ACTIVE', user: { telegramAccount: { isNot: null } } },
      select: { user: { select: { telegramAccount: { select: { telegramId: true } } } } },
    });
    if (!members.length) return;
    const token = await this.botTokenFor(organizationId).catch(() => null);
    if (!token) return;
    const sent = await Promise.allSettled(members.map((m) => this.bot.sendMessage(token, Number(m.user.telegramAccount!.telegramId), text)));
    // A member who never opened the bot can't be messaged.
    const failed = sent.filter((r) => r.status === 'rejected').length;
    if (failed) this.logger.warn(`Team notification: ${failed}/${members.length} deliveries failed`);
  }

  // ── sign-in ──

  /**
   * Mini App sign-in. initData is verified with the store's bot token before anything in it is used;
   * the same signed payload is accepted once. Returns our own short-lived access token + rotating refresh token.
   */
  async authenticate(req: AppRequest, initData: string, storeSlug: string) {
    if (!this.tokens.enabled) throw new ServiceUnavailableException('Telegram sign-in is not configured (JWT_SECRET)');
    const org = await this.db.organization.findFirst({ where: { slug: storeSlug, deletedAt: null }, select: { id: true, slug: true, name: true, status: true } });
    if (!org) throw new NotFoundException('Store not found');
    if (org.status !== 'ACTIVE') throw new ForbiddenException('Store is unavailable');

    let verified;
    try {
      verified = verifyInitData(initData, await this.botTokenFor(org.id), this.env.TELEGRAM_INITDATA_MAX_AGE_SEC);
    } catch (error) {
      if (error instanceof InitDataError) throw new UnauthorizedException('Invalid Telegram data');
      throw error;
    }
    await this.entitlements.assertFeature(org.id, 'telegram_mini_app');

    // Replay protection: one session per signed launch payload.
    await this.db.telegramInitDataUse.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    try {
      await this.db.telegramInitDataUse.create({
        data: { hash: sha256(verified.hash), expiresAt: new Date(verified.authDate.getTime() + (this.env.TELEGRAM_INITDATA_MAX_AGE_SEC + 60) * 1000) },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new UnauthorizedException('Telegram data was already used — reopen the app');
      throw error;
    }

    const linkCode = verified.startParam?.startsWith(LINK_PREFIX) ? verified.startParam.slice(LINK_PREFIX.length) : undefined;
    const refreshToken = randomToken(32);

    const { user, session } = await this.db.$transaction(async (tx) => {
      const tg = verified.user;
      const telegramId = BigInt(tg.id);
      const accountData = {
        username: tg.username ?? null,
        firstName: tg.first_name ?? null,
        lastName: tg.last_name ?? null,
        photoUrl: tg.photo_url?.startsWith('https://') ? tg.photo_url : null,
        languageCode: tg.language_code ?? null,
        lastAuthAt: new Date(),
      };
      const existing = await tx.telegramAccount.findUnique({ where: { telegramId }, select: { userId: true } });

      let userId: string;
      if (linkCode) {
        const code = await tx.telegramLinkCode.findUnique({ where: { codeHash: sha256(linkCode) } });
        if (!code || code.usedAt || code.expiresAt <= new Date()) throw new BadRequestException('Link code is invalid or expired');
        await tx.telegramLinkCode.update({ where: { id: code.id }, data: { usedAt: new Date() } });
        if (existing && existing.userId !== code.userId) throw new ConflictException('This Telegram account is already linked to another user');
        const other = await tx.telegramAccount.findUnique({ where: { userId: code.userId }, select: { telegramId: true } });
        if (other && other.telegramId !== telegramId) throw new ConflictException('Your account is already linked to another Telegram account');
        userId = code.userId;
        await tx.telegramAccount.upsert({ where: { telegramId }, update: accountData, create: { userId, telegramId, ...accountData } });
      } else if (existing) {
        userId = existing.userId;
        await tx.telegramAccount.update({ where: { telegramId }, data: accountData });
      } else {
        const created = await tx.user.create({
          data: {
            profile: { create: { displayName: displayName(tg), locale: tg.language_code === 'en' ? 'en' : 'ru', avatarUrl: accountData.photoUrl } },
            settings: { create: {} },
            telegramAccount: { create: { telegramId, ...accountData } },
          },
        });
        userId = created.id;
      }

      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, status: true, profile: { select: { displayName: true, avatarUrl: true, locale: true } } } });
      if (user.status === 'BLOCKED') throw new ForbiddenException('Account is blocked');
      if (user.status === 'DELETED') throw new ForbiddenException('Account was deleted');
      // Profile sync: fill gaps from Telegram, never overwrite what the user set themselves.
      if (!user.profile?.displayName) await tx.profile.updateMany({ where: { userId }, data: { displayName: displayName(verified.user) } });

      const session = await tx.session.create({
        data: {
          userId,
          kind: 'TELEGRAM',
          refreshTokenHash: sha256(refreshToken),
          organizationId: org.id,
          userAgent: req.headers['user-agent']?.slice(0, 300),
          ip: req.ip,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      return { user, session };
    });

    await this.audit.record({ principal: { kind: 'user', user: { id: user.id, email: user.email, status: user.status } }, ip: req.ip, headers: req.headers }, {
      action: linkCode ? 'telegram.linked' : 'telegram.signed_in',
      organizationId: org.id,
      entityType: 'session',
      entityId: session.id,
    });

    return {
      accessToken: await this.tokens.sign(user.id, session.id),
      refreshToken,
      expiresIn: ACCESS_TTL_SEC,
      user: { id: user.id, displayName: user.profile?.displayName ?? displayName(verified.user), avatarUrl: user.profile?.avatarUrl ?? null, locale: user.profile?.locale ?? 'ru' },
      store: { id: org.id, slug: org.slug, name: org.name },
    };
  }

  /** Rotating refresh: every use replaces the token, so a stolen-and-used token stops working for its owner and is noticed. */
  async refresh(refreshToken: string) {
    const session = await this.db.session.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!session || session.kind !== 'TELEGRAM' || session.revokedAt || (session.expiresAt && session.expiresAt <= new Date()) || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Session expired — reopen the app');
    }
    const next = randomToken(32);
    const { count } = await this.db.session.updateMany({
      where: { id: session.id, refreshTokenHash: sha256(refreshToken), revokedAt: null },
      data: { refreshTokenHash: sha256(next), lastSeenAt: new Date() },
    });
    if (!count) throw new UnauthorizedException('Session expired — reopen the app'); // lost a race with a parallel refresh
    return { accessToken: await this.tokens.sign(session.userId, session.id), refreshToken: next, expiresIn: ACCESS_TTL_SEC };
  }

  // ── account linking ──

  async createLinkCode(req: AppRequest, userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { supabaseId: true, telegramAccount: { select: { id: true } } } });
    if (!user.supabaseId) throw new ConflictException('Linking starts from a web account');
    if (user.telegramAccount) throw new ConflictException('Telegram is already linked');
    const code = randomToken(16);
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.db.telegramLinkCode.create({ data: { codeHash: sha256(code), userId, expiresAt } });
    await this.audit.record(req, { action: 'telegram.link_code_created', entityType: 'user', entityId: userId });
    return { startParam: `${LINK_PREFIX}${code}`, expiresAt };
  }

  async unlink(req: AppRequest, userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { supabaseId: true, telegramAccount: { select: { id: true } } } });
    if (!user.telegramAccount) throw new NotFoundException('Telegram is not linked');
    if (!user.supabaseId) throw new ConflictException('Telegram is your only way to sign in — it cannot be unlinked');
    await this.db.$transaction(async (tx) => {
      await tx.telegramAccount.delete({ where: { userId } });
      await tx.session.updateMany({ where: { userId, kind: 'TELEGRAM', revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(req, { action: 'telegram.unlinked', entityType: 'user', entityId: userId }, tx);
    });
  }

  // ── brand bot integration ──

  async status(tenant: Tenant) {
    const own = await this.integration(tenant.organizationId);
    return {
      connected: own?.status === 'ACTIVE',
      bot: own ? (own.publicConfig as Record<string, unknown>) : null,
      usingPlatformBot: own?.status !== 'ACTIVE' && !!this.env.TELEGRAM_BOT_TOKEN,
    };
  }

  /** Connects the brand's own bot: validates the token with Telegram, stores it encrypted, registers webhook + menu button. */
  async connect(req: AppRequest, tenant: Tenant, botToken: string) {
    if (!this.box) throw new ServiceUnavailableException('Bot connection is not configured (ENCRYPTION_KEY)');
    let me;
    try {
      me = await this.bot.getMe(botToken);
    } catch (error) {
      if (error instanceof BotApiError) throw new UnprocessableEntityException('Telegram rejected this bot token');
      throw error;
    }
    const taken = await this.db.integration.findFirst({
      where: { kind: 'TELEGRAM_BOT', publicConfig: { path: ['botId'], equals: me.id }, NOT: { organizationId: tenant.organizationId, provider: 'telegram' } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('This bot is already in use (another store, or your support bot)');

    const org = await this.db.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { slug: true } });
    const secrets: BotSecrets = { botToken, webhookSecret: randomToken(24) };
    const publicConfig: Record<string, unknown> = { botId: me.id, username: me.username, webhook: false, menuButton: false };
    const row = await this.db.integration.upsert({
      where: { organizationId_kind_provider: { organizationId: tenant.organizationId, kind: 'TELEGRAM_BOT', provider: 'telegram' } },
      update: { secretEncrypted: this.box.seal(JSON.stringify(secrets)), publicConfig: publicConfig as object, status: 'ACTIVE' },
      create: { organizationId: tenant.organizationId, kind: 'TELEGRAM_BOT', provider: 'telegram', secretEncrypted: this.box.seal(JSON.stringify(secrets)), publicConfig: publicConfig as object },
    });

    // Telegram only talks to HTTPS: on localhost these steps are skipped and reported, not failed.
    if (isHttps(this.env.PUBLIC_API_URL)) {
      await this.bot
        .setWebhook(botToken, `${trimSlash(this.env.PUBLIC_API_URL!)}/api/v1/telegram/webhook/${row.id}`, secrets.webhookSecret)
        .then(() => (publicConfig.webhook = true))
        .catch((e: unknown) => this.logger.warn(`setWebhook failed: ${String(e)}`));
    }
    if (isHttps(this.env.PUBLIC_MINI_APP_URL)) {
      await this.bot
        .setChatMenuButton(botToken, 'Open store', this.storeUrl(org.slug))
        .then(() => (publicConfig.menuButton = true))
        .catch((e: unknown) => this.logger.warn(`setChatMenuButton failed: ${String(e)}`));
    }
    await this.db.integration.update({ where: { id: row.id }, data: { publicConfig: publicConfig as object } });
    await this.audit.record(req, { action: 'telegram.bot_connected', organizationId: tenant.organizationId, entityType: 'integration', entityId: row.id, metadata: { username: me.username } });
    return { connected: true, bot: publicConfig, usingPlatformBot: false };
  }

  async disconnect(req: AppRequest, tenant: Tenant) {
    const own = await this.integration(tenant.organizationId);
    if (!own) throw new NotFoundException('No bot is connected');
    try {
      await this.bot.deleteWebhook(this.openSecrets(own.secretEncrypted).botToken);
    } catch (e) {
      this.logger.warn(`deleteWebhook failed: ${String(e)}`);
    }
    await this.db.integration.delete({ where: { id: own.id } });
    await this.audit.record(req, { action: 'telegram.bot_disconnected', organizationId: tenant.organizationId, entityType: 'integration', entityId: own.id });
  }

  /** Bot updates. Authentic only with the secret token Telegram echoes back (set at setWebhook). */
  async handleUpdate(integrationId: string, secretHeader: string | undefined, update: unknown) {
    const row = await this.db.integration.findFirst({
      where: { id: integrationId, kind: 'TELEGRAM_BOT', provider: 'telegram', status: 'ACTIVE' },
      include: { organization: { select: { slug: true, name: true, status: true } } },
    });
    if (!row) throw new NotFoundException();
    const secrets = this.openSecrets(row.secretEncrypted);
    if (!secretHeader || !safeEqualHex(sha256(secretHeader), sha256(secrets.webhookSecret))) throw new UnauthorizedException();

    const message = (update as { message?: { text?: string; chat?: { id?: number } } })?.message;
    const chatId = message?.chat?.id;
    if (typeof chatId === 'number' && message?.text?.startsWith('/start') && row.organization.status === 'ACTIVE') {
      const url = this.storeUrl(row.organization.slug);
      await this.bot
        .sendMessage(secrets.botToken, chatId, `${row.organization.name} — tap to open the store.`, isHttps(url) ? { text: 'Open store', webAppUrl: url } : undefined)
        .catch((e: unknown) => this.logger.warn(`sendMessage failed: ${String(e)}`));
    }
    return { ok: true };
  }
}

function displayName(u: TelegramWebAppUser) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 80) || u.username || 'Telegram user';
}
