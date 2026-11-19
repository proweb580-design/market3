'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { formatMoney } from '../lib/format';
import { CheckoutError, fetchOrder, type BuyerOrder } from './checkout-client';
import { useStore } from './store-context';

const HEADLINE: Record<BuyerOrder['status'], { title: string; text: string }> = {
  PENDING_PAYMENT: { title: 'Waiting for payment', text: 'We haven’t received your payment yet. This page updates automatically.' },
  PAID: { title: 'Thank you — order confirmed', text: 'We’ve received your payment and will start preparing your order.' },
  FULFILLED: { title: 'Order shipped', text: 'Your order has been handed over for delivery.' },
  CANCELED: { title: 'Order canceled', text: 'This order was not paid in time or was canceled. Nothing was charged.' },
  REFUNDED: { title: 'Order refunded', text: 'Your payment has been refunded.' },
};

/** Buyer's order page: opened from the payment page's return link (token in the URL) or by the signed-in buyer. */
export function OrderView({ orderId }: { orderId: string }) {
  const { store, href, host, clearCart } = useStore();
  const search = useSearchParams();
  const token = search.get('token');
  const justPaid = search.get('result') === 'success';
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      try {
        const authToken = (await host?.getAuthToken()) ?? null;
        const next = await fetchOrder(store.slug, orderId, token, authToken);
        if (cancelled) return;
        setOrder(next);
        setError(null);
        // Payment pages can take a moment to confirm: poll for a couple of minutes while it is unpaid.
        if (next.status === 'PENDING_PAYMENT' && justPaid && attempts++ < 30) timer = setTimeout(load, 4000);
      } catch (e) {
        if (!cancelled) setError(e instanceof CheckoutError && e.status === 404 ? 'We couldn’t find this order. Open the link from your payment confirmation.' : 'Could not load your order. Please try again.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store.slug, orderId, token, justPaid, host]);

  const paid = order?.status === 'PAID' || order?.status === 'FULFILLED';
  useEffect(() => {
    if (paid) clearCart();
  }, [paid, clearCart]);

  if (error) {
    return (
      <div role="alert" className="px-page py-24 text-center">
        <p className="text-sm">{error}</p>
        <Button asChild className="mt-6"><Link href={href()}>Back to the store</Link></Button>
      </div>
    );
  }
  if (!order) return <p className="px-page py-24 text-center text-xs text-muted-foreground" aria-busy="true">Loading your order…</p>;

  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: order.currency });
  const head = HEADLINE[order.status];
  return (
    <div className="mx-auto max-w-xl px-page py-16">
      <p className="label-xs text-muted-foreground">Order #{order.number}</p>
      <h1 className="title-xl mt-1 text-4xl">{head.title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">{head.text}</p>
      {order.contactEmail && <p className="mt-1 text-xs text-muted-foreground">Updates go to {order.contactEmail}.</p>}

      {order.payUrl && (
        <Button className="mt-6" onClick={() => (host ? host.openLink(order.payUrl!) : window.location.assign(order.payUrl!))}>
          Continue to payment
        </Button>
      )}

      <ul className="mt-8 divide-y divide-border border-y border-border">
        {order.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-3 py-3 text-xs">
            <span>{i.productTitle} · {i.variantTitle} × {i.quantity}</span>
            <span className="tabular-nums">{money(i.totalMinor)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-4 flex flex-col gap-1 text-xs">
        <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(order.subtotalMinor)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular-nums">{order.shippingMinor === 0 ? 'Free' : money(order.shippingMinor)}</dd></div>
        <div className="flex justify-between font-bold"><dt>Total</dt><dd className="tabular-nums">{money(order.totalMinor)}</dd></div>
      </dl>
      <Button asChild variant="outline" className="mt-8"><Link href={href()}>Continue shopping</Link></Button>
    </div>
  );
}
