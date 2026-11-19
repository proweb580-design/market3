'use client';

import { orderCheckoutSchema, type Quote } from '@repo/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { formatMoney } from '../lib/format';
import { CheckoutError, placeOrder, quoteCart } from './checkout-client';
import { useStore, variantFor } from './store-context';

type Fields = { email: string; name: string; line1: string; city: string; postalCode: string; country: string; phone: string; note: string };
const EMPTY: Fields = { email: '', name: '', line1: '', city: '', postalCode: '', country: '', phone: '', note: '' };

const FIELDS: { key: keyof Fields; label: string; autoComplete: string; type?: string; required?: boolean; max?: number }[] = [
  { key: 'email', label: 'Email', autoComplete: 'email', type: 'email', required: true },
  { key: 'name', label: 'Full name', autoComplete: 'name', required: true },
  { key: 'line1', label: 'Address', autoComplete: 'address-line1', required: true },
  { key: 'city', label: 'City', autoComplete: 'address-level2', required: true },
  { key: 'postalCode', label: 'Postal code', autoComplete: 'postal-code', required: true },
  { key: 'country', label: 'Country (2 letters, e.g. DE)', autoComplete: 'country', required: true, max: 2 },
  { key: 'phone', label: 'Phone (optional)', autoComplete: 'tel', type: 'tel' },
];

/**
 * Checkout step of the cart: re-prices the cart on the server, collects contact + address and sends the buyer to the
 * hosted payment page. The browser only says *what* to buy; the totals shown here are the server's.
 */
export function CheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { store, cart, productBySlug, variant, host } = useStore();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lines = cart.flatMap((l) => {
    const p = productBySlug(l.productSlug);
    const v = p && variantFor(p, l.size, l.color);
    return v ? [{ variantId: v.id, quantity: l.quantity }] : [];
  });
  const linesKey = JSON.stringify(lines);

  useEffect(() => {
    if (!open || lines.length === 0) return;
    let cancelled = false;
    setQuote(null);
    setMessage(null);
    quoteCart(store.slug, lines)
      .then((q) => !cancelled && setQuote(q))
      .catch((e: unknown) => !cancelled && setMessage(e instanceof CheckoutError ? e.message : 'Could not price your cart.'));
    return () => {
      cancelled = true;
    };
    // `lines` is derived from `linesKey`; depending on the string avoids re-running on every render.
  }, [open, linesKey, store.slug]);

  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: quote?.currency ?? store.currency });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const parsed = orderCheckoutSchema.safeParse({
      lines,
      channel: variant === 'miniapp' ? 'telegram' : 'web',
      email: form.email,
      phone: form.phone || undefined,
      note: form.note || undefined,
      shippingAddress: { name: form.name, line1: form.line1, city: form.city, postalCode: form.postalCode, country: form.country },
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'shippingAddress' ? (issue.path[1] === 'name' ? 'name' : (issue.path[1] as keyof Fields)) : (issue.path[0] as keyof Fields);
        if (key in EMPTY) next[key] = issue.message.startsWith('Too small') ? 'This field is required' : issue.message;
        else setMessage(issue.message);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const token = (await host?.getAuthToken()) ?? null;
      const order = await placeOrder(store.slug, parsed.data, token);
      // The cart is cleared when the order page confirms payment, so a cancelled payment keeps it.
      if (host) host.openLink(order.checkoutUrl);
      else window.location.assign(order.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof CheckoutError ? error.message : 'Something went wrong. Please try again.');
      // Stock may have changed: refresh the quote.
      quoteCart(store.slug, lines).then(setQuote).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const blocked = quote ? !quote.ok : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] max-w-lg gap-0 overflow-y-auto rounded-lg p-6">
        <DialogTitle className="label-xs font-bold">Checkout</DialogTitle>
        <DialogDescription className="mt-1 text-xs text-muted-foreground">You’ll pay on a secure payment page.</DialogDescription>

        <section className="mt-4 border-b border-border pb-4" aria-label="Order summary">
          {quote ? (
            <>
              <ul className="flex flex-col gap-1.5">
                {quote.lines.map((l) => (
                  <li key={l.variantId} className="flex justify-between gap-3 text-xs">
                    <span className={l.ok ? '' : 'text-destructive'}>
                      {l.productTitle || 'Item no longer available'}
                      {l.variantTitle && ` · ${l.variantTitle}`} × {l.quantity}
                      {!l.ok && l.available > 0 && ` (only ${l.available} left)`}
                      {!l.ok && l.available === 0 && ' — sold out'}
                    </span>
                    <span className="tabular-nums">{money(l.totalMinor)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{money(quote.subtotalMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular-nums">{quote.shippingMinor === 0 ? 'Free' : money(quote.shippingMinor)}</dd></div>
                <div className="flex justify-between font-bold"><dt>Total</dt><dd className="tabular-nums">{money(quote.totalMinor)}</dd></div>
              </dl>
              {!quote.ok && <p role="alert" className="mt-3 text-xs text-destructive">Some items are unavailable. Remove them from your cart to continue.</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground" aria-busy="true">Calculating totals…</p>
          )}
        </section>

        <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={`co-${f.key}`} className="label-xs">{f.label}</Label>
              <Input
                id={`co-${f.key}`}
                type={f.type ?? 'text'}
                value={form[f.key]}
                autoComplete={f.autoComplete}
                maxLength={f.max}
                aria-invalid={!!errors[f.key]}
                aria-describedby={errors[f.key] ? `co-${f.key}-err` : undefined}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
              {errors[f.key] && <p id={`co-${f.key}-err`} className="text-[11px] text-destructive">{errors[f.key]}</p>}
            </div>
          ))}
          {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
          <Button type="submit" className="mt-2 w-full" disabled={busy || blocked}>
            {busy ? 'Redirecting to payment…' : `Pay ${quote ? money(quote.totalMinor) : ''}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
