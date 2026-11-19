import type { OrderCheckoutInput, Quote } from '@repo/shared';

/** Browser-side calls of the public checkout API. Prices come back from the server; nothing here decides money. */

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API}/api/v1/storefront/${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).catch(() => {
    throw new CheckoutError('Could not reach the store. Check your connection and try again.', 0);
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new CheckoutError(message ?? 'Something went wrong. Please try again.', res.status);
  }
  return (await res.json()) as T;
}

export const quoteCart = (store: string, lines: { variantId: string; quantity: number }[]) =>
  call<Quote>(`${encodeURIComponent(store)}/quote`, { method: 'POST', body: JSON.stringify({ lines }) });

export const placeOrder = (store: string, input: OrderCheckoutInput, token: string | null) =>
  call<{ orderId: string; number: number; token: string; checkoutUrl: string; expiresAt: string }>(`${encodeURIComponent(store)}/checkout`, {
    method: 'POST',
    body: JSON.stringify(input),
    token,
  });

/** Signed-in buyer's wishlist for one store (the server keeps it per account). */
export const fetchWishlist = (store: string, token: string) =>
  call<{ slugs: string[] }>(`${encodeURIComponent(store)}/wishlist`, { token });

export const setWishlisted = (store: string, productSlug: string, on: boolean, token: string) =>
  call<{ slugs: string[] }>(`${encodeURIComponent(store)}/wishlist/${encodeURIComponent(productSlug)}`, { method: on ? 'PUT' : 'DELETE', token });

export interface BuyerOrder {
  id: string;
  number: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'FULFILLED' | 'CANCELED' | 'REFUNDED';
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  contactEmail: string | null;
  items: { productTitle: string; variantTitle: string; unitPriceMinor: number; quantity: number; totalMinor: number }[];
  payUrl: string | null;
}

export const fetchOrder = (store: string, orderId: string, orderToken: string | null, authToken: string | null) =>
  call<BuyerOrder>(`${encodeURIComponent(store)}/orders/${encodeURIComponent(orderId)}${orderToken ? `?token=${encodeURIComponent(orderToken)}` : ''}`, { token: authToken });
