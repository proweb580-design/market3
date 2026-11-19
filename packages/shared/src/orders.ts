import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

/*
 * Checkout and order contracts. The client only ever sends *what it wants* (variant ids and quantities);
 * prices, stock, shipping and totals are decided by the server.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

export const cartLinesSchema = z
  .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10) }).strict())
  .min(1)
  .max(30)
  .refine((l) => new Set(l.map((x) => x.variantId)).size === l.length, 'Duplicate variant');

export const shippingAddressSchema = z
  .object({
    name: text(100),
    line1: text(200),
    line2: z.string().trim().max(200).optional(),
    city: text(100),
    region: z.string().trim().max(100).optional(),
    postalCode: text(20),
    country: z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code').transform((c) => c.toUpperCase()),
  })
  .strict();

export const quoteSchema = z.object({ lines: cartLinesSchema }).strict();

export const orderCheckoutSchema = z
  .object({
    lines: cartLinesSchema,
    /** Where the buyer comes from; decides the return address after payment. */
    channel: z.enum(['web', 'telegram']).default('web'),
    email: z.email().max(254).transform((v) => v.toLowerCase()),
    phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone').optional(),
    shippingAddress: shippingAddressSchema,
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type OrderCheckoutInput = z.infer<typeof orderCheckoutSchema>;

export const orderTokenQuerySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }).strict();

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'PAID', 'FULFILLED', 'CANCELED', 'REFUNDED'] as const;
export const ordersQuerySchema = paginationQuerySchema
  .extend({ status: z.enum(ORDER_STATUSES).optional(), q: z.string().trim().max(100).optional() })
  .strict();

export interface QuoteLine {
  variantId: string;
  productSlug: string;
  productTitle: string;
  variantTitle: string;
  unitPriceMinor: number;
  quantity: number;
  totalMinor: number;
  /** Units the store can still sell; the line is not purchasable when below `quantity`. */
  available: number;
  ok: boolean;
}

export interface Quote {
  currency: string;
  lines: QuoteLine[];
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  ok: boolean;
}
