import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SUPPORT_TOPIC_LABEL, type PaginationQuery, type SupportMessage, type SupportTicketStatus, type supportTicketsQuerySchema } from '@repo/shared';
import type { z } from 'zod';
import { randomToken, safeEqualHex, sha256 } from '../../common/crypto.js';
import { pageArgs, toPage } from '../../common/pagination.js';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { SecretBox } from '../../common/secret-box.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BOT_API, type BotApi, BotApiError, type CallbackButton } from '../telegram/bot-api.js';
import { TelegramService } from '../telegram/telegram.service.js';

/** The support bot is a second Telegram bot per store; it posts tickets into the team's group. */
const PROVIDER = 'telegram-support';

interface SupportBotSecrets {
  botToken: string;
  webhookSecret: string;
}

interface SupportBotConfig {
  botId: number;
  username: string;
  webhook: boolean;
  /** One-time code for `/bind@<bot> <code>` in the team group; cleared once a group is bound. */
  bindCode: string | null;
  chatId: number | null;
  chatTitle: string | null;
}

interface TicketRow {
  id: string;
  name: string;
  email: string;
  orderNumber: string | null;
  topic: string;
  message: string;
  status: SupportTicketStatus;
  assignee: string | null;
}

const STATUS_LINE: Record<SupportTicketStatus, (who: string | null) => string> = {
  NEW: () => '🆕 Новое',
  IN_PROGRESS: (who) => `🛠 В работе${who ? ` — ${who}` : ''}`,
  RESOLVED: (who) => `✅ Решено${who ? ` — ${who}` : ''}`,
};

/** Plain text (no parse_mode): buyer input can't inject markup or links into the team chat. */
export function ticketText(t: TicketRow, storeName: string) {
  return [
    `Обращение · ${SUPPORT_TOPIC_LABEL[t.topic as SupportMessage['topic']] ?? t.topic} · ${storeName}`,
    `От: ${t.name} <${t.email}>`,
    ...(t.orderNumber ? [`Заказ: ${t.orderNumber}`] : []),
    '',
    t.message,
    '',
    `Статус: ${STATUS_LINE[t.status](t.assignee)}`,
  ].join('\n');
}

export function ticketButtons(t: Pick<TicketRow, 'id' | 'status'>): CallbackButton[] {
  const b = (text: string, status: SupportTicketStatus) => ({ text, data: `${status}:${t.id}` });
  if (t.status === 'NEW') return [b('🛠 Взял в работу', 'IN_PROGRESS'), b('✅ Решено', 'RESOLVED')];
  if (t.status === 'IN_PROGRESS') return [b('✅ Решено', 'RESOLVED')];
  return [b('↩️ Открыть снова', 'NEW')];
}

const CALLBACK = /^(NEW|IN_PROGRESS|RESOLVED):([0-9a-f-]{36})$/;
const BIND = /^\/bind(?:@(\w+))?\s+(\S+)/;

const isHttps = (url?: string) => !!url && url.startsWith('https://');
const trimSlash = (url: string) => url.replace(/\/+$/, '');

@Injectable()
export class SupportService {
  private readonly logger = new Logger('Support');
  private readonly box: SecretBox | null;

  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramService,
    @Inject(ENV) private readonly env: Env,
    @Inject(BOT_API) private readonly bot: BotApi,
  ) {
    this.box = env.ENCRYPTION_KEY ? new SecretBox(env.ENCRYPTION_KEY) : null;
  }

  // ── tickets ──

  /** Storefront form. The ticket is saved first; Telegram delivery is best effort and never fails the request. */
  async create(storeSlug: string, msg: SupportMessage) {
    const org = await this.db.organization.findFirst({ where: { slug: storeSlug, deletedAt: null, status: 'ACTIVE' }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException('Store not found');
    const ticket = await this.db.supportTicket.create({
      data: { organizationId: org.id, name: msg.name, email: msg.email, orderNumber: msg.orderNumber ?? null, topic: msg.topic, message: msg.message },
    });

    try {
      const bot = await this.boundBot(org.id);
      if (bot) {
        const messageId = await this.bot.sendButtons(bot.secrets.botToken, bot.config.chatId!, ticketText(ticket, org.name), ticketButtons(ticket));
        await this.db.supportTicket.update({ where: { id: ticket.id }, data: { telegramChatId: BigInt(bot.config.chatId!), telegramMessageId: messageId } });
      } else {
        await this.telegram.notifyTeam(org.id, ticketText(ticket, org.name));
      }
    } catch (e) {
      this.logger.warn(`Ticket ${ticket.id}: Telegram delivery failed: ${String(e)}`);
    }
    return { ok: true };
  }

  async list(tenant: Tenant, q: PaginationQuery & z.infer<typeof supportTicketsQuerySchema>) {
    const where = { organizationId: tenant.organizationId, ...(q.status && { status: q.status }) };
    const [rows, total, open] = await Promise.all([
      this.db.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), omit: { telegramChatId: true, telegramMessageId: true } }),
      this.db.supportTicket.count({ where }),
      this.db.supportTicket.count({ where: { organizationId: tenant.organizationId, status: { not: 'RESOLVED' } } }),
    ]);
    return { ...toPage(rows, total, q), open };
  }

  /** Dashboard status change; the group message is updated to match. */
  async setStatus(req: AppRequest, tenant: Tenant, ticketId: string, status: SupportTicketStatus, who: string) {
    const ticket = await this.db.supportTicket.findFirst({ where: { id: ticketId, organizationId: tenant.organizationId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const updated = await this.apply(ticket, status, who);
    await this.audit.record(req, { action: 'support.ticket_status', organizationId: tenant.organizationId, entityType: 'support_ticket', entityId: ticketId, metadata: { status } });
    const { telegramChatId: _c, telegramMessageId: _m, ...dto } = updated;
    return dto;
  }

  private async apply(ticket: TicketRow & { organizationId: string }, status: SupportTicketStatus, who: string) {
    const updated = await this.db.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status,
        // "Take" claims it; resolving keeps whoever took it (or credits the resolver); reopening clears it.
        assignee: status === 'NEW' ? null : status === 'IN_PROGRESS' ? who : (ticket.assignee ?? who),
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
      },
    });
    if (updated.telegramChatId != null && updated.telegramMessageId != null) {
      const bot = await this.boundBot(ticket.organizationId).catch(() => null);
      const org = await this.db.organization.findUniqueOrThrow({ where: { id: ticket.organizationId }, select: { name: true } });
      if (bot)
        await this.bot
          .editButtons(bot.secrets.botToken, Number(updated.telegramChatId), updated.telegramMessageId, ticketText(updated, org.name), ticketButtons(updated))
          .catch((e: unknown) => this.logger.warn(`editMessageText failed: ${String(e)}`));
    }
    return updated;
  }

  // ── support bot ──

  private integration(organizationId: string) {
    return this.db.integration.findUnique({ where: { organizationId_kind_provider: { organizationId, kind: 'TELEGRAM_BOT', provider: PROVIDER } } });
  }

  private open(envelope: string | null): SupportBotSecrets {
    if (!this.box || !envelope) throw new ServiceUnavailableException('Bot credentials are unavailable (ENCRYPTION_KEY)');
    return JSON.parse(this.box.open(envelope)) as SupportBotSecrets;
  }

  private async boundBot(organizationId: string) {
    const row = await this.integration(organizationId);
    const config = row?.publicConfig as SupportBotConfig | undefined;
    if (row?.status !== 'ACTIVE' || config?.chatId == null) return null;
    return { secrets: this.open(row.secretEncrypted), config };
  }

  async status(tenant: Tenant) {
    const row = await this.integration(tenant.organizationId);
    return { connected: row?.status === 'ACTIVE', bot: row ? (row.publicConfig as unknown as SupportBotConfig) : null };
  }

  /** Validates the token, stores it encrypted, registers the webhook and hands out a one-time group bind code. */
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
      where: { kind: 'TELEGRAM_BOT', publicConfig: { path: ['botId'], equals: me.id }, NOT: { organizationId: tenant.organizationId, provider: PROVIDER } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('This bot is already in use — create a separate bot for support');

    const secrets: SupportBotSecrets = { botToken, webhookSecret: randomToken(24) };
    const config: SupportBotConfig = { botId: me.id, username: me.username, webhook: false, bindCode: randomToken(9), chatId: null, chatTitle: null };
    const sealed = this.box.seal(JSON.stringify(secrets));
    const row = await this.db.integration.upsert({
      where: { organizationId_kind_provider: { organizationId: tenant.organizationId, kind: 'TELEGRAM_BOT', provider: PROVIDER } },
      update: { secretEncrypted: sealed, publicConfig: config as object, status: 'ACTIVE' },
      create: { organizationId: tenant.organizationId, kind: 'TELEGRAM_BOT', provider: PROVIDER, secretEncrypted: sealed, publicConfig: config as object },
    });
    // Telegram only calls HTTPS webhooks: on localhost this is skipped and reported, not failed.
    if (isHttps(this.env.PUBLIC_API_URL)) {
      await this.bot
        .setWebhook(botToken, `${trimSlash(this.env.PUBLIC_API_URL!)}/api/v1/support/webhook/${row.id}`, secrets.webhookSecret, ['message', 'callback_query'])
        .then(() => (config.webhook = true))
        .catch((e: unknown) => this.logger.warn(`setWebhook failed: ${String(e)}`));
      await this.db.integration.update({ where: { id: row.id }, data: { publicConfig: config as object } });
    }
    await this.audit.record(req, { action: 'support.bot_connected', organizationId: tenant.organizationId, entityType: 'integration', entityId: row.id, metadata: { username: me.username } });
    return { connected: true, bot: config };
  }

  async disconnect(req: AppRequest, tenant: Tenant) {
    const row = await this.integration(tenant.organizationId);
    if (!row) throw new NotFoundException('No support bot is connected');
    await this.bot.deleteWebhook(this.open(row.secretEncrypted).botToken).catch((e: unknown) => this.logger.warn(`deleteWebhook failed: ${String(e)}`));
    await this.db.integration.delete({ where: { id: row.id } });
    await this.audit.record(req, { action: 'support.bot_disconnected', organizationId: tenant.organizationId, entityType: 'integration', entityId: row.id });
  }

  /** Support bot updates. Authentic only with the secret token Telegram echoes back (set at setWebhook). */
  async handleUpdate(integrationId: string, secretHeader: string | undefined, update: unknown) {
    const row = await this.db.integration.findFirst({ where: { id: integrationId, kind: 'TELEGRAM_BOT', provider: PROVIDER, status: 'ACTIVE' } });
    if (!row) throw new NotFoundException();
    const secrets = this.open(row.secretEncrypted);
    if (!secretHeader || !safeEqualHex(sha256(secretHeader), sha256(secrets.webhookSecret))) throw new UnauthorizedException();
    const config = row.publicConfig as unknown as SupportBotConfig;
    const u = update as TelegramUpdate;

    // `/bind@<bot> <code>` in a group: proves the sender saw the code in the dashboard.
    const msg = u?.message;
    const bind = msg?.text ? BIND.exec(msg.text) : null;
    if (msg?.chat && bind && config.bindCode && (!bind[1] || bind[1].toLowerCase() === config.username.toLowerCase())) {
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        await this.bot.sendMessage(secrets.botToken, msg.chat.id, 'Добавьте бота в группу команды и отправьте команду там.').catch(() => undefined);
      } else if (safeEqualHex(sha256(bind[2]!), sha256(config.bindCode))) {
        const next: SupportBotConfig = { ...config, bindCode: null, chatId: msg.chat.id, chatTitle: msg.chat.title ?? null };
        await this.db.integration.update({ where: { id: row.id }, data: { publicConfig: next as object } });
        await this.bot.sendMessage(secrets.botToken, msg.chat.id, 'Группа подключена. Сюда будут приходить обращения покупателей.').catch(() => undefined);
      }
      return { ok: true };
    }

    // Buttons under a ticket — only from the bound group, only for this store's tickets.
    const cb = u?.callback_query;
    if (cb) {
      const m = CALLBACK.exec(cb.data ?? '');
      const fromGroup = cb.message?.chat?.id === config.chatId;
      const ticket = m && fromGroup ? await this.db.supportTicket.findFirst({ where: { id: m[2], organizationId: row.organizationId } }) : null;
      if (!ticket) {
        await this.bot.answerCallback(secrets.botToken, cb.id, 'Обращение не найдено').catch(() => undefined);
        return { ok: true };
      }
      const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ') || (cb.from?.username ? `@${cb.from.username}` : 'Telegram');
      await this.apply(ticket, m![1] as SupportTicketStatus, who.slice(0, 80));
      await this.bot.answerCallback(secrets.botToken, cb.id).catch(() => undefined);
    }
    return { ok: true };
  }
}

interface TelegramUpdate {
  message?: { text?: string; chat?: { id: number; type?: string; title?: string } };
  callback_query?: {
    id: string;
    data?: string;
    from?: { first_name?: string; last_name?: string; username?: string };
    message?: { chat?: { id: number } };
  };
}
