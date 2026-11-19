import { cacheLife } from 'next/cache';
import type { StoreCatalog, StoreCollection, StoreConfig } from '@repo/shared';

/**
 * Server-side reads of the public storefront API. Cached per store for a few minutes ('use cache'),
 * so a page costs at most two API calls per store, however many visitors and pages there are.
 * Brand edits show up within the cache window.
 */

// API_URL: server-to-server address (e.g. a private network name); falls back to the public one.
const apiBase = () => (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

async function read<T>(path: string): Promise<T | null> {
  'use cache';
  cacheLife('minutes');
  const res = await fetch(`${apiBase()}/api/v1/storefront/${path}`, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storefront API responded ${res.status} for /${path}`);
  return (await res.json()) as T;
}

export const getStore = (store: string) => read<StoreConfig>(encodeURIComponent(store));
export const getCatalog = (store: string) => read<StoreCatalog>(`${encodeURIComponent(store)}/catalog`);

export async function getProducts(store: string) {
  return (await getCatalog(store))?.products ?? [];
}

export async function getProduct(store: string, slug: string) {
  return (await getProducts(store)).find((p) => p.slug === slug) ?? null;
}

export async function getCollection(store: string, slug: string): Promise<StoreCollection | null> {
  const catalog = await getCatalog(store);
  const collection = catalog?.collections.find((c) => c.slug === slug);
  if (!catalog || !collection) return null;
  const bySlug = new Map(catalog.products.map((p) => [p.slug, p]));
  return { slug: collection.slug, title: collection.title, products: collection.productSlugs.flatMap((s) => bySlug.get(s) ?? []) };
}
