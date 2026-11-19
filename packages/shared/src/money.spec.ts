import { describe, expect, it } from 'vitest';
import { createOrganizationSchema, createPlanSchema } from './index.js';
import { currencyCode, fromMinor, slugify, toMinor } from './money.js';

describe('money helpers', () => {
  it('parses prices into minor units without float drift', () => {
    expect(toMinor('12.50')).toBe(1250);
    expect(toMinor('12,5')).toBe(1250);
    expect(toMinor(' 0.29 ')).toBe(29);
    expect(toMinor('19')).toBe(1900);
    expect(toMinor('1.005')).toBeNull(); // third decimal: refuse instead of guessing
    expect(toMinor('-3')).toBeNull();
    expect(toMinor('')).toBeNull();
    expect(toMinor('12.5.1')).toBeNull();
    expect(toMinor('1e3')).toBeNull();
  });

  it('formats minor units back, and round-trips', () => {
    expect(fromMinor(1250)).toBe('12.50');
    expect(fromMinor(null)).toBe('');
    for (const v of ['0.01', '9.99', '1234.50']) expect(fromMinor(toMinor(v))).toBe(v);
  });

  it('makes URL-safe slugs', () => {
    expect(slugify('  Quilt Puffer (Black)! ')).toBe('quilt-puffer-black');
    expect(slugify('Ünïcode Tee')).toBe('unicode-tee');
    expect(slugify('---')).toBe('');
  });

  it('accepts only two-decimal currencies for stores and plans', () => {
    expect(currencyCode.safeParse('EUR').success).toBe(true);
    for (const bad of ['JPY', 'KRW', 'BHD', 'usd', 'US']) expect(currencyCode.safeParse(bad).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ slug: 'my-shop', name: 'My shop', currency: 'JPY' }).success).toBe(false);
    expect(createOrganizationSchema.parse({ slug: 'my-shop', name: 'My shop' }).currency).toBe('USD');
    expect(createPlanSchema.safeParse({ code: 'JP', name: 'Plan', priceMinor: 1, currency: 'JPY', interval: 'MONTH' }).success).toBe(false);
  });
});
