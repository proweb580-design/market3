'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Ruler, ShoppingBag } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/format';
import { Button } from '../components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { ProductImage } from './media';
import { OptionChip, PaymentBadges, QuantityStepper, Swatches, TrustBar } from './primitives';
import { ProductCard } from './product-card';
import { FitFinderDialog, SizeGuideDialog } from './size-dialogs';
import { useStore } from './store-context';
import type { StoreProduct } from './types';

function Gallery({ product, tone }: { product: StoreProduct; tone: string }) {
  const [i, setI] = useState(0);
  const n = product.media.length;
  const go = (d: number) => setI((i + d + n) % n);
  return (
    <div className="relative">
      <div className="relative mx-auto aspect-square max-w-[640px]">
        {product.media.map((m, idx) => (
          <div
            key={idx}
            aria-hidden={idx !== i}
            className="absolute inset-0 flex items-center justify-center transition-[opacity,filter,transform] duration-700"
            style={{ opacity: idx === i ? 1 : 0, filter: idx === i ? 'none' : 'blur(8px)', transform: idx === i ? 'none' : 'scale(0.96)' }}
          >
            <ProductImage media={m} tone={tone} priority={idx === 0} className="w-[82%]" />
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" onClick={() => go(-1)} aria-label="Previous image" className="absolute left-0 top-1/2 -translate-y-1/2 p-2 opacity-60 hover:opacity-100">
            <ChevronLeft strokeWidth={1.25} className="size-5" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next image" className="absolute right-0 top-1/2 -translate-y-1/2 p-2 opacity-60 hover:opacity-100">
            <ChevronRight strokeWidth={1.25} className="size-5" />
          </button>
        </>
      )}
      <div className="mx-auto mt-4 h-px max-w-[420px] bg-border" aria-hidden>
        <div className="h-px bg-foreground transition-[width] duration-700" style={{ width: `${((i + 1) / n) * 100}%` }} />
      </div>
    </div>
  );
}

/** Reference §2.4: media left, info column right, trust bar, description and the "Other" upsell row. */
export function ProductView({
  product,
  collection,
  prevSlug,
  nextSlug,
  related,
}: {
  product: StoreProduct;
  collection: { slug: string; title: string };
  prevSlug?: string;
  nextSlug?: string;
  related: StoreProduct[];
}) {
  const { store, href, addToCart, setOverlay, wishlist, toggleWishlist, setPrimaryAction, nativePrimary } = useStore();
  const firstInStock = product.sizes.find((s) => s.inStock)?.label;
  const [size, setSize] = useState<string | undefined>(firstInStock);
  const [color, setColor] = useState(product.colors[0]!);
  const [fabric, setFabric] = useState(product.fabrics[0]);
  const [qty, setQty] = useState(1);
  const [dialog, setDialog] = useState<'fit' | 'guide' | null>(null);
  const liked = wishlist.has(product.slug);
  const total = formatMoney({ ...product.price, amountMinor: product.price.amountMinor * qty });

  const add = () => {
    if (!size) return;
    addToCart({ productSlug: product.slug, size, color: color.name, quantity: qty });
    setOverlay('cart');
  };

  // Offer "add to cart" as the page's main action; a host (Telegram MainButton) may render it natively.
  useEffect(() => {
    setPrimaryAction({ label: size ? `Add to cart · ${total}` : 'Select a size', onClick: add, disabled: !size });
    return () => setPrimaryAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `add` closes over exactly these values
  }, [size, color.name, qty, total, product.slug]);

  return (
    <div className="px-page pt-8">
      <div className="grid gap-10 md:grid-cols-12">
        <div className="md:sticky md:top-8 md:col-span-7 md:self-start">
          <Gallery product={product} tone={color.hex} />
        </div>

        <div className="flex flex-col md:col-span-5 lg:col-span-4 lg:col-start-9">
          <nav aria-label="Breadcrumb" className="label-xs text-muted-foreground">
            <Link href={href(`/collections/${store.grid?.collection ?? collection.slug}`)} className="hover:text-foreground">
              Shop
            </Link>{' '}
            /{' '}
            <Link href={href(`/collections/${collection.slug}`)} className="hover:text-foreground">
              {collection.title}
            </Link>{' '}
            / <span aria-current="page">{product.title}</span>
          </nav>
          <h1 className="title-xl mt-3 text-4xl lg:text-5xl">{product.title}</h1>
          <p className="mt-3 text-sm tabular-nums">{formatMoney(product.price)}</p>

          <div className="mt-6 flex flex-col gap-5">
            <fieldset>
              <legend className="label-xs mb-2 text-muted-foreground">Size</legend>
              <div className="flex flex-wrap gap-1.5">
                {product.sizes.map((s) => (
                  <OptionChip key={s.label} selected={size === s.label} unavailable={!s.inStock} disabled={!s.inStock} onClick={() => setSize(s.label)} aria-label={`Size ${s.label}${s.inStock ? '' : ', sold out'}`}>
                    {s.label}
                  </OptionChip>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label-xs mb-2 text-muted-foreground">Colour — {color.name}</legend>
              <Swatches size="lg" colors={product.colors} selected={color.name} onSelect={(n) => setColor(product.colors.find((c) => c.name === n)!)} />
            </fieldset>
            <fieldset>
              <legend className="label-xs mb-2 text-muted-foreground">Fabric</legend>
              <div className="flex gap-1.5">
                {product.fabrics.map((f) => (
                  <OptionChip key={f} selected={fabric === f} onClick={() => setFabric(f)}>
                    {f}
                  </OptionChip>
                ))}
              </div>
            </fieldset>
            {product.sizeChart && (
              <div className="flex gap-5">
                <button type="button" onClick={() => setDialog('fit')} className="label-xs flex items-center gap-1.5 font-bold hover:underline">
                  <Ruler className="size-3.5" /> Find my size
                </button>
                <button type="button" onClick={() => setDialog('guide')} className="label-xs text-muted-foreground hover:text-foreground hover:underline">
                  Size guide
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="label-xs text-muted-foreground">Quantity</span>
              <QuantityStepper value={qty} onChange={setQty} />
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <Button className="flex-1" onClick={add} disabled={!size}>
              <ShoppingBag className="size-3.5" /> Add to cart {total}
            </Button>
            <Button variant="outline" size="icon" className="size-11" aria-pressed={liked} aria-label={liked ? 'Remove from wishlist' : 'Add to wishlist'} onClick={() => toggleWishlist(product.slug)}>
              <Heart className={cn('size-4', liked && 'fill-current')} />
            </Button>
          </div>
          <div className="label-xs mt-4 flex justify-between text-muted-foreground">
            {prevSlug ? (
              <Link href={href(`/products/${prevSlug}`)} className="hover:text-foreground">
                ‹ Prev
              </Link>
            ) : (
              <span />
            )}
            {nextSlug && (
              <Link href={href(`/products/${nextSlug}`)} className="hover:text-foreground">
                Next ›
              </Link>
            )}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <TrustBar items={store.trust} />
            <PaymentBadges badges={store.paymentBadges} className="mt-5" />
          </div>

          <Accordion type="single" collapsible defaultValue="description" className="mt-6 border-t border-border">
            <AccordionItem value="description">
              <AccordionTrigger className="label-xs font-bold hover:no-underline">Description</AccordionTrigger>
              <AccordionContent>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                  {product.description.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="shipping">
              <AccordionTrigger className="label-xs font-bold hover:no-underline">Shipping &amp; returns</AccordionTrigger>
              <AccordionContent className="text-xs text-muted-foreground">
                Ships in 1–3 business days. Free returns within 30 days of delivery.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {related.length > 0 && (
        <section className="pt-24" aria-labelledby="other-title">
          <h2 id="other-title" className="title-xl text-2xl sm:text-3xl">
            Other
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
            {related.slice(0, 4).map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Mobile sticky purchase bar (no reference for mobile). Hidden when a host renders the primary action natively (Telegram MainButton). */}
      <div className={cn('fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur md:hidden', nativePrimary && 'hidden')}>
        <div className="min-w-0 flex-1">
          <p className="label-xs truncate font-bold">{product.title}</p>
          <p className="label-xs text-muted-foreground">{size ? `Size ${size}` : 'Select a size'}</p>
        </div>
        <Button onClick={add} disabled={!size}>
          Add · {total}
        </Button>
      </div>

      {product.sizeChart && (
        <>
          <SizeGuideDialog chart={product.sizeChart} open={dialog === 'guide'} onOpenChange={(o) => setDialog(o ? 'guide' : null)} />
          <FitFinderDialog chart={product.sizeChart} open={dialog === 'fit'} onOpenChange={(o) => setDialog(o ? 'fit' : null)}
            onSelectSize={setSize}
            soldOut={product.sizes.filter((s) => !s.inStock).map((s) => s.label)}
          />
        </>
      )}
    </div>
  );
}
