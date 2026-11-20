'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { formatMoney } from '../lib/format';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../components/ui/sheet';
import { CheckoutDialog } from './checkout-dialog';
import { ProductImage } from './media';
import { QuantityStepper } from './primitives';
import { useStore } from './store-context';

/** Reference §2.5: right drawer with free-shipping progress and line items. */
export function CartSheet() {
  const { store, cart, productBySlug, setQuantity, cartCount, subtotalMinor, overlay, setOverlay, href } = useStore();
  const [agreed, setAgreed] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const threshold = store.freeShippingThresholdMinor;
  const progress = threshold ? Math.min(100, Math.round((subtotalMinor / threshold) * 100)) : 0;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: store.currency });

  return (
    <Sheet open={overlay === 'cart'} onOpenChange={(open) => setOverlay(open ? 'cart' : null)}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[460px]">
        <div className="border-b border-border px-6 pb-4 pt-6">
          <div className="flex items-baseline justify-between pr-8">
            <SheetTitle className="label-xs font-bold">Cart ({cartCount})</SheetTitle>
            {threshold !== null && <span className="label-xs tabular-nums text-muted-foreground">{progress}%</span>}
          </div>
          {threshold === null ? (
            <SheetDescription className="sr-only">Your cart</SheetDescription>
          ) : (
            <>
              <SheetDescription className="label-xs mt-3 text-muted-foreground">
                {subtotalMinor >= threshold
                  ? 'You’ve unlocked free shipping!'
                  : `Spend ${money(threshold - subtotalMinor)} more for free shipping`}
              </SheetDescription>
              <div className="mt-2 h-0.5 w-full bg-border" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Free shipping progress">
                <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {cart.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Your cart is empty.</p>
          ) : (
            <ul className="divide-y divide-border">
              {cart.map((line) => {
                const p = productBySlug(line.productSlug);
                if (!p) return null;
                const color = p.colors.find((c) => c.name === line.color) ?? p.colors[0]!;
                return (
                  <li key={`${line.productSlug}-${line.size}-${line.color}`} className="flex gap-4 py-4">
                    <Link href={href(`/products/${p.slug}`)} onClick={() => setOverlay(null)} className="w-16 shrink-0">
                      <ProductImage media={p.media[0]!} tone={color.hex} />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="label-xs font-bold">{p.title}</p>
                          <p className="label-xs text-muted-foreground">
                            {line.size} / {line.color} / {p.fabrics[0]}
                          </p>
                        </div>
                        <p className="label-xs tabular-nums">{money(p.price.amountMinor * line.quantity)}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <QuantityStepper value={line.quantity} onChange={(q) => setQuantity(line, q)} />
                        <button type="button" onClick={() => setQuantity(line, 0)} className="p-1 text-muted-foreground hover:text-foreground" aria-label={`Remove ${p.title}`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-6 pb-6 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="label-xs font-bold">Subtotal</span>
            <span className="text-sm font-bold tabular-nums">{money(subtotalMinor)}</span>
          </div>
          <p className="label-xs mt-1 text-muted-foreground">Taxes and shipping calculated at checkout</p>
          <label className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-px" />
            I agree with the Terms and Conditions and Privacy Policy
          </label>
          <Button className="mt-4 w-full" disabled={!agreed || cart.length === 0} onClick={() => setCheckingOut(true)}>
            Checkout · {money(subtotalMinor)}
          </Button>
        </div>
      </SheetContent>
      <CheckoutDialog open={checkingOut} onOpenChange={setCheckingOut} />
    </Sheet>
  );
}
