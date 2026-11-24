import { z } from 'zod';
import { currencyCode } from './money.js';
import { paginationQuerySchema } from './pagination.js';
import { PERMISSION_KEYS } from './permissions.js';

/** Request contracts shared by the API (validation) and the web apps (form resolvers). */

export const uuid = z.uuid();
export const orgSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/, 'Use a-z, 0-9 and dashes (2–48 chars)');
export const roleKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use UPPER_SNAKE_CASE (2–40 chars)');
const email = z.email().max(254).transform((v) => v.toLowerCase());
const permissionKey = z.enum(PERMISSION_KEYS as [string, ...string[]]);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

// ── profile & settings ──
export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable(),
    avatarUrl: httpsUrl.nullable(),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone').nullable(),
    locale: z.enum(['ru', 'en']),
    timezone: z.string().max(64).nullable(),
  })
  .partial()
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const settingsUpdateSchema = z
  .object({
    theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']),
    marketingEmails: z.boolean(),
    // {"orders": {"email": true, "telegram": false}} — booleans only, bounded size.
    notifications: z.record(z.string().max(40), z.record(z.string().max(40), z.boolean())).refine((v) => Object.keys(v).length <= 20, 'Too many keys'),
  })
  .partial()
  .strict();
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

// ── organizations ──
export const createOrganizationSchema = z
  .object({
    slug: orgSlug,
    name: z.string().trim().min(2).max(80),
    currency: currencyCode.default('USD'),
  })
  .strict();

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    logoUrl: httpsUrl.nullable(),
    settings: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 16_000, 'Settings too large'),
  })
  .partial()
  .strict();

export const updateMemberSchema = z.object({ roleId: uuid }).strict();
export const createInvitationSchema = z.object({ email, roleId: uuid }).strict();
export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) }).strict();

// ── RBAC ──
export const createRoleSchema = z
  .object({
    key: roleKey,
    name: z.string().trim().min(2).max(60),
    description: z.string().max(240).optional(),
    permissions: z.array(permissionKey).max(PERMISSION_KEYS.length),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().max(240).nullable(),
    permissions: z.array(permissionKey).max(PERMISSION_KEYS.length),
  })
  .partial()
  .strict();

export const assignRoleSchema = z.object({ roleId: uuid }).strict();

// ── API keys ──
export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    scopes: z.array(permissionKey).min(1).max(PERMISSION_KEYS.length),
    rateLimitPerMinute: z.number().int().min(1).max(6000).default(60),
    expiresInDays: z.number().int().min(1).max(730).optional(),
  })
  .strict();

// ── admin ──
export const blockUserSchema = z.object({ reason: z.string().trim().max(240).optional() }).strict();

export const adminUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'BLOCKED', 'DELETED']).optional(),
});

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(80).optional(),
  actorUserId: uuid.optional(),
  organizationId: uuid.optional(),
});

// ── Telegram ──
export const telegramAuthSchema = z.object({ initData: z.string().min(1).max(8192), store: orgSlug }).strict();
export const telegramRefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
/** Storefront "Поддержка" form; delivered to the store team in Telegram. */
export const supportMessageSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email,
    orderNumber: z.string().trim().max(20).optional(),
    topic: z.enum(['order', 'delivery', 'returns', 'product', 'other']),
    message: z.string().trim().min(10).max(2000),
  })
  .strict();
export type SupportMessage = z.infer<typeof supportMessageSchema>;
export const connectBotSchema = z
  .object({ botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'Paste the token from @BotFather') })
  .strict();
