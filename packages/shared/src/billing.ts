import { z } from 'zod';
import { currencyCode } from './money.js';
import { paginationQuerySchema } from './pagination.js';
import { PLAN_FEATURES, type PlanFeatureKey } from './plans.js';

/** Billing request contracts (API validation + dashboard/admin forms). */

const planCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/, 'UPPER_SNAKE_CASE, 2–30 chars');
const currency = currencyCode;

/** { "products.max": { enabled: true, limit: 100 }, "api_access": { enabled: true } } — limit null = unlimited. */
export const planFeaturesSchema = z
  .record(z.string(), z.object({ enabled: z.boolean(), limit: z.number().int().min(0).nullable().optional() }).strict())
  .superRefine((features, ctx) => {
    for (const [key, value] of Object.entries(features)) {
      const def = PLAN_FEATURES[key as PlanFeatureKey];
      if (!def) ctx.addIssue({ code: 'custom', path: [key], message: 'Unknown feature' });
      else if (def.kind === 'flag' && value.limit !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: 'Flag features take no limit' });
    }
  });

export const createPlanSchema = z
  .object({
    code: planCode,
    name: z.string().trim().min(2).max(60),
    description: z.string().max(500).optional(),
    priceMinor: z.number().int().min(0).max(100_000_000_000),
    currency,
    interval: z.enum(['MONTH', 'YEAR']),
    trialDays: z.number().int().min(0).max(90).default(0),
    isActive: z.boolean().default(true),
    isPublic: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    features: planFeaturesSchema.default({}),
  })
  .strict();

/** The code is immutable; everything else may change (new prices apply to future payments only). */
export const updatePlanSchema = createPlanSchema.omit({ code: true }).partial().strict();

export const checkoutSchema = z.object({ planCode }).strict();
export const startTrialSchema = z.object({ planCode }).strict();

export const grantSubscriptionSchema = z
  .object({ planCode, days: z.number().int().min(1).max(3660), reason: z.string().trim().max(240).optional() })
  .strict();

export const refundSchema = z
  .object({ amountMinor: z.number().int().positive().optional(), reason: z.string().trim().max(240).optional() })
  .strict();

export const paymentsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
  organizationId: z.uuid().optional(),
});

export const subscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']).optional(),
  organizationId: z.uuid().optional(),
});
