import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client (public URL + publishable key only — no secrets ever reach the browser).
 * Returns null when the project is not configured, so pages can say so instead of crashing.
 */
let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient(url, key) : null;
  return client;
}

/** The current access token (refreshed by Supabase when needed), or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Only same-site paths may be used as a post-login destination (no open redirects). */
export function safeNext(value: string | null | undefined, fallback = '/account') {
  return value && /^\/(?!\/)[\w\-./?=&%]*$/.test(value) && !value.includes('..') ? value : fallback;
}
