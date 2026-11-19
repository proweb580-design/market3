import { getAccessToken } from './supabase';

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls the platform API as the signed-in user (bearer token from Supabase). Throws ApiError on any non-2xx. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch(() => {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    throw new ApiError(Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? 'Something went wrong. Please try again.'), res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
