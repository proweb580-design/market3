'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/format';
import { PanelView, ProductImage } from './media';
import { ProductCard } from './product-card';
import { SectionHeading, Swatches } from './primitives';
import { useStore } from './store-context';
import type { StoreProduct } from './types';

/** Reference §2.2b: photo triptych under the translucent header, dissolving into the page background. */
export function HeroBanner() {
  const { store, href } = useStore();
  const hero = store.hero!;
  const shop = store.grid?.collection ?? store.collections[0]?.slug;
  return (
    <section className="relative h-[92svh] min-h-[520px] overflow-hidden" aria-label={hero.title}>
      <div className="grid h-full grid-cols-1 md:grid-cols-3">
        {hero.panels.map((panel, i) => (
          <PanelView key={i} panel={panel} className={cn(i !== 1 && 'max-md:hidden')} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-background" />
      <div className="absolute inset-x-0 top-[30%] flex flex-col items-center px-page text-center text-white">
        <p className="label-xs opacity-80">{hero.eyebrow}</p>
        <h1 className="title-xl mt-2 text-6xl drop-shadow-lg sm:text-7xl">{hero.title}</h1>
        <p className="mt-2 text-xs opacity-80">{hero.subtitle}</p>
        {shop && (
          <Link
            href={href(`/collections/${shop}`)}
            className="label-xs mt-6 inline-flex items-center gap-2 border-b border-white/60 pb-0.5 font-bold transition-opacity hover:opacity-70"
          >
            Shop the drop <ArrowRight className="size-3" />
          </Link>
        )}
      </div>
    </section>
  );
}

/** Reference §2.2a: coverflow — focused cut-out in the middle, blurred neighbours, cross-fade between items. */
export function FeaturedCarousel() {
  const { store, productBySlug, href } = useStore();
  const featured = store.featured!;
  const items = featured.productSlugs.map(productBySlug).filter((p): p is StoreProduct => !!p);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = items.length;
  const go = (d: number) => setActive((a) => (a + d + n) % n);

  useEffect(() => {
    if (paused || n < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % n), 4500);
    return () => clearInterval(id);
  }, [paused, n]);

  const current = items[active];
  if (!current) return null;

  return (
    <section
      className="overflow-x-clip px-page pt-10"
      aria-roledescription="carousel"
      aria-label={featured.title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <SectionHeading title={featured.title} eyebrow={featured.subtitle} />
      <div
        className="relative mx-auto h-[min(62vw,520px)] max-md:h-[78vw]"
        onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0]!.clientX - touchX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        {items.map((p, i) => {
          let offset = i - active;
          if (offset > n / 2) offset -= n;
          if (offset < -n / 2) offset += n;
          const hidden = Math.abs(offset) > 1;
          return (
            <Link
              key={p.slug}
              href={href(`/products/${p.slug}`)}
              tabIndex={offset === 0 ? 0 : -1}
              aria-hidden={offset !== 0}
              className="absolute left-1/2 top-1/2 w-[min(42vw,420px)] max-md:w-[64vw]"
              style={{
                transform: `translate(-50%, -50%) translateX(${offset * 105}%) scale(${offset === 0 ? 1 : 0.6})`,
                opacity: hidden ? 0 : offset === 0 ? 1 : 0.45,
                filter: offset === 0 ? 'none' : 'blur(3px)',
                zIndex: offset === 0 ? 2 : 1,
                pointerEvents: hidden ? 'none' : undefined,
                transition: 'transform 700ms cubic-bezier(.2,.7,.2,1), opacity 700ms, filter 700ms',
              }}
            >
              <ProductImage media={p.media[0]!} tone={p.colors[0]!.hex} priority={offset === 0} />
            </Link>
          );
        })}
        <button type="button" onClick={() => go(-1)} aria-label="Previous product" className="absolute left-[22%] top-1/2 z-10 -translate-y-1/2 p-2 opacity-60 hover:opacity-100 max-md:left-0">
          <ChevronLeft strokeWidth={1.25} className="size-5" />
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Next product" className="absolute right-[22%] top-1/2 z-10 -translate-y-1/2 p-2 opacity-60 hover:opacity-100 max-md:right-0">
          <ChevronRight strokeWidth={1.25} className="size-5" />
        </button>
      </div>

      <div className="mx-auto max-w-sm" aria-live="polite">
        <div className="h-px w-full bg-border">
          <div className="h-px bg-foreground transition-[width] duration-700" style={{ width: `${((active + 1) / n) * 100}%` }} />
        </div>
        <div key={current.slug} className="mt-3 animate-in fade-in duration-500">
          <Link href={href(`/products/${current.slug}`)} className="label-xs font-bold hover:underline">
            {current.title}
          </Link>
          <p className="label-xs tabular-nums text-muted-foreground">{formatMoney(current.price)}</p>
          <div className="mt-2 flex items-center gap-3">
            <Swatches colors={current.colors} selected={current.colors[0]!.name} />
            <span className="label-xs text-muted-foreground">{current.sizes.map((s) => s.label).join('  ')}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProductGridSection({ title, products, viewAllPath }: { title: string; products: StoreProduct[]; viewAllPath: string }) {
  const { href } = useStore();
  return (
    <section className="px-page pt-24">
      <SectionHeading
        title={title}
        action={
          <Link href={href(viewAllPath)} className="label-xs font-bold hover:underline">
            View all
          </Link>
        }
      />
      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
    </section>
  );
}

function useCountdown(target: string) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = Date.parse(target);
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  return left;
}

/** Reference §2.2d: drop teaser with a live countdown (client-only so prerendering stays deterministic). */
export function DropCountdown() {
  const { store } = useStore();
  const drop = store.drop!;
  const left = useCountdown(drop.endsAt);
  const s = left === null ? null : Math.floor(left / 1000);
  const parts: [string, number | null][] = [
    ['Days', s === null ? null : Math.floor(s / 86400)],
    ['Hours', s === null ? null : Math.floor(s / 3600) % 24],
    ['Min', s === null ? null : Math.floor(s / 60) % 60],
    ['Sec', s === null ? null : s % 60],
  ];

  return (
    <section className="px-page pt-24" aria-label={drop.title}>
      <div className="relative h-[min(46vw,520px)] min-h-[320px] overflow-hidden rounded-sm">
        <PanelView panel={drop.panel} />
        <div className="absolute inset-0 bg-black/45" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="label-xs opacity-80">{drop.eyebrow}</p>
          <h2 className="title-xl mt-2 max-w-[14ch] text-4xl sm:text-6xl">{drop.title}</h2>
          <div className="mt-6 flex gap-5 sm:gap-8" role="timer" aria-live="off">
            {parts.map(([label, value]) => (
              <div key={label} className="flex flex-col items-center">
                <span className="title-xl text-3xl tabular-nums sm:text-4xl">{value === null ? '--' : String(value).padStart(2, '0')}</span>
                <span className="label-xs mt-1 opacity-70">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CollectionsRow() {
  const { store, href } = useStore();
  return (
    <section className="px-page pt-24">
      <SectionHeading title="Collections" />
      <div className="mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:overflow-visible">
        {store.collections.map((c, i) => (
          <Link key={c.title + i} href={href(`/collections/${c.slug}`)} className="group w-[70vw] shrink-0 snap-start md:w-auto">
            <div className="aspect-[3/4] overflow-hidden rounded-sm">
              <PanelView panel={c.panel} className="transition-transform duration-700 group-hover:scale-[1.04]" />
            </div>
            <p className="label-xs mt-2 font-bold">{c.title}</p>
            <p className="label-xs text-muted-foreground">Shop now</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function SocialFeed() {
  const { store } = useStore();
  return (
    <section className="px-page pt-24">
      <SectionHeading
        title="Follow along"
        action={<span className="label-xs text-muted-foreground">{store.social!.handle}</span>}
      />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {store.social!.panels.map((p, i) => (
          <div key={i} className={cn('aspect-[4/5] overflow-hidden rounded-sm', i > 3 && 'max-lg:hidden', i > 1 && 'max-sm:hidden')}>
            <PanelView panel={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
