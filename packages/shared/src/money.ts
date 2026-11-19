import { z } from 'zod';

/**
 * Prices are stored and sent to the payment provider as "amount × 100". That is only correct for currencies with
 * two decimals, so only those are accepted (yen, won, dinars and similar would be charged 100× or 1000× wrong).
 */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'RUB', 'UAH', 'KZT', 'TRY', 'AED'] as const;
export const currencyCode = z.enum(SUPPORTED_CURRENCIES, { error: 'Unsupported currency: only two-decimal currencies are accepted' });

/** "12.50" / "12,5" → 1250. Null for anything that is not a non-negative amount with at most 2 decimals. */
export function toMinor(text: string): number | null {
  const t = text.trim().replace(',', '.');
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}

export const fromMinor = (minor: number | null | undefined) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2));

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop accents: Ü → U
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
