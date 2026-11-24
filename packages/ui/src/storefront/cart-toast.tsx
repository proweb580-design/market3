'use client';

import { ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/format';
import { ProductImage } from './media';
import { useStore } from './store-context';

const VISIBLE_MS = 2000;
const EXIT_MS = 300;

/** "Added to cart" card under the header: slides in on every add, slides out after ~2 s. Click opens the cart. */
export function CartToast() {
  const { lastAdded, productBySlug, setOverlay } = useStore();
  const [phase, setPhase] = useState<'in' | 'out' | 'hidden'>('hidden');

  useEffect(() => {
    if (!lastAdded) return;
    setPhase('in');
    const out = setTimeout(() => setPhase('out'), VISIBLE_MS);
    const hide = setTimeout(() => setPhase('hidden'), VISIBLE_MS + EXIT_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(hide);
    };
  }, [lastAdded]);

  const p = lastAdded && productBySlug(lastAdded.line.productSlug);
  if (phase === 'hidden' || !lastAdded || !p) return null;
  const color = p.colors.find((c) => c.name === lastAdded.line.color) ?? p.colors[0]!;

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 top-20 z-50 flex justify-end sm:left-auto sm:right-6">
      <button
        key={lastAdded.at}
        type="button"
        onClick={() => {
          setPhase('hidden');
          setOverlay('cart');
        }}
        className={cn(
          'pointer-events-auto w-full max-w-sm rounded-lg border border-border bg-background p-4 text-left shadow-lg',
          phase === 'in'
            ? 'animate-in fade-in slide-in-from-top-4 duration-300'
            : 'animate-out fade-out slide-out-to-top-4 fill-mode-forwards duration-300',
        )}
      >
        <p className="flex items-center gap-2 text-sm">
          <ShoppingBag className="size-4" aria-hidden />
          Товар добавлен в корзину
        </p>
        <div className="mt-3 flex items-center gap-4">
          <div className="w-16 shrink-0 overflow-hidden rounded-md">
            <ProductImage media={p.media[0]!} tone={color.hex} />
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold tabular-nums">
              {formatMoney({ ...p.price, amountMinor: p.price.amountMinor * lastAdded.line.quantity })}
            </p>
            <p className="truncate text-sm">{p.title}</p>
            <p className="label-xs text-muted-foreground">
              {lastAdded.line.size} / {lastAdded.line.color}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}
