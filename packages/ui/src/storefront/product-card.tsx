'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/format';
import { ProductImage } from './media';
import { Swatches } from './primitives';
import { useStore } from './store-context';
import type { StoreProduct } from './types';

/** Reference §3.1: cut-out on page background, in-card image arrows, wishlist, swatches and quick-add sizes. */
export function ProductCard({ product, className }: { product: StoreProduct; className?: string }) {
  const { href, wishlist, toggleWishlist, addToCart, setOverlay } = useStore();
  const [mediaIndex, setMediaIndex] = useState(0);
  const [color, setColor] = useState(product.colors[0]!);
  const media = product.media[mediaIndex] ?? product.media[0]!;
  const url = href(`/products/${product.slug}`);
  const liked = wishlist.has(product.slug);
  const step = (d: number) => setMediaIndex((mediaIndex + d + product.media.length) % product.media.length);
  const arrow =
    'absolute top-1/2 -translate-y-1/2 p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100';

  return (
    <article className={cn('group flex flex-col', className)}>
      <div className="relative">
        <Link href={url} aria-label={product.title} className="block px-[8%] py-[6%]">
          <ProductImage media={media} tone={color.hex} className="transition-transform duration-500 group-hover:scale-[1.03]" />
        </Link>
        {product.media.length > 1 && (
          <>
            <button type="button" className={cn(arrow, 'left-0')} aria-label="Previous image" onClick={() => step(-1)}>
              <ChevronLeft strokeWidth={1.5} className="size-4" />
            </button>
            <button type="button" className={cn(arrow, 'right-0')} aria-label="Next image" onClick={() => step(1)}>
              <ChevronRight strokeWidth={1.5} className="size-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => toggleWishlist(product.slug)}
          aria-pressed={liked}
          aria-label={liked ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`}
          className="absolute right-0 top-0 p-1.5 transition-opacity hover:opacity-60"
        >
          <Heart strokeWidth={1.5} className={cn('size-3.5', liked && 'fill-red-500 text-red-500')} />
        </button>
      </div>

      <div className="mt-2 border-t border-border pt-2">
        {product.label && <p className="label-xs text-muted-foreground">{product.label}</p>}
        <Link href={url} className="label-xs block font-bold hover:underline">
          {product.title}
        </Link>
        <p className="label-xs tabular-nums text-muted-foreground">{formatMoney(product.price)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Swatches colors={product.colors} selected={color.name} onSelect={(n) => setColor(product.colors.find((c) => c.name === n)!)} />
          <div className="flex flex-wrap gap-x-1.5" aria-label="Quick add size">
            {product.sizes.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={!s.inStock}
                onClick={() => {
                  addToCart({ productSlug: product.slug, size: s.label, color: color.name, quantity: 1 });
                  setOverlay('cart');
                }}
                className="label-xs text-muted-foreground transition-colors hover:text-foreground disabled:line-through disabled:opacity-50"
                aria-label={`Add size ${s.label} to cart`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
