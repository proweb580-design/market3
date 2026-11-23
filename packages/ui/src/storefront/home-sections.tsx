'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatMoney } from '../lib/format';
import { PanelView, ProductImage } from './media';
import { ProductCard } from './product-card';
import { SectionHeading, Swatches } from './primitives';
import { useStore } from './store-context';
import type { StoreProduct } from './types';

/** Hero photos settle from a slight zoom one after another; the delay lives in the shorthand (a separate animation-delay would be reset by it). */
const HERO_ZOOM = [
  'motion-safe:animate-[hero-in_1.6s_cubic-bezier(.2,.7,.2,1)_both]',
  'motion-safe:animate-[hero-in_1.6s_cubic-bezier(.2,.7,.2,1)_150ms_both]',
  'motion-safe:animate-[hero-in_1.6s_cubic-bezier(.2,.7,.2,1)_300ms_both]',
];

/** Reference §2.2b: photo triptych under the translucent header, dissolving into the page background. */
export function HeroBanner() {
  const { store, href } = useStore();
  const hero = store.hero!;
  const shop = store.grid?.collection ?? store.collections[0]?.slug;
  return (
    // Sized to the photos (3:4 each — one on phones, three across from md) so they show whole instead of a cropped half.
    <section className="relative aspect-[3/4] max-h-[100svh] w-full overflow-hidden md:aspect-[9/4]" aria-label={hero.title}>
      <div className="grid h-full grid-cols-1 md:grid-cols-3">
        {hero.panels.map((panel, i) => (
          <PanelView
            key={i}
            panel={panel}
            // the middle photo is the one shown on every screen size (and the phone's largest paint)
            priority={i === 1}
            className={cn('object-[50%_25%]', HERO_ZOOM[i], i !== 1 && 'max-md:hidden')}
          />
        ))}
      </div>
      {/* Light scrim keeps the white title readable on bright photos; a short fade melts the bottom edge into the page. */}
      <div className="pointer-events-none absolute inset-0 bg-black/20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-background" />
      <div className="intro-reveal absolute inset-x-0 top-[30%] flex flex-col items-center px-page text-center text-white motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700 motion-safe:delay-300 motion-safe:fill-mode-backwards">
        <h1 className="title-xl text-6xl drop-shadow-lg sm:text-7xl">{hero.title}</h1>
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
  const dragged = useRef(false);
  const section = useRef<HTMLElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const n = items.length;
  const prevActive = useRef(active);
  useEffect(() => {
    prevActive.current = active;
  });
  const go = (d: number) => setActive((a) => (a + d + n) % n);

  // Autoplay only while the carousel is in view: off screen its blurred cross-fades are paint work nobody sees.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(!!entry?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !onScreen || n < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % n), 4500);
    return () => clearInterval(id);
  }, [paused, onScreen, n]);

  const current = items[active];
  if (!current) return null;

  return (
    <section
      ref={section}
      className="overflow-x-clip px-page pt-10"
      aria-roledescription="карусель"
      aria-label={featured.title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <SectionHeading title={featured.title} eyebrow={featured.subtitle} />
      <div
        className="reveal relative mx-auto h-[min(62vw,520px)] cursor-grab touch-pan-y select-none active:cursor-grabbing max-md:h-[78vw]"
        // Pointer events cover mouse drag and touch swipe alike.
        onPointerDown={(e) => {
          touchX.current = e.clientX;
          dragged.current = false;
        }}
        onPointerUp={(e) => {
          if (touchX.current === null) return;
          const dx = e.clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) {
            dragged.current = true;
            go(dx < 0 ? 1 : -1);
          }
        }}
        onPointerCancel={() => (touchX.current = null)}
        // A drag must not open the product it ended on, nor start the browser's native image/link drag.
        onClickCapture={(e) => dragged.current && e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {items.map((p, i) => {
          const wrap = (o: number) => (o > n / 2 ? o - n : o < -n / 2 ? o + n : o);
          const offset = wrap(i - active);
          // An item wrapping from one end to the other would slide across the centre; jump it and only fade.
          const jumped = Math.abs(offset - wrap(i - prevActive.current)) > 1;
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
                // Own compositor layer: repainting the moving blurred image left torn fragments behind it in Chrome.
                willChange: 'transform, opacity, filter',
                backfaceVisibility: 'hidden',
                transition: jumped ? 'opacity 700ms' : 'transform 700ms cubic-bezier(.2,.7,.2,1), opacity 700ms, filter 700ms',
              }}
            >
              <ProductImage media={p.media[0]!} tone={p.colors[0]!.hex} priority={offset === 0} />
            </Link>
          );
        })}
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
          <div className="mt-2">
            <Swatches colors={current.colors} selected={current.colors[0]!.name} />
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
          <ProductCard key={p.slug} product={p} quickAdd={false} />
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
    ['Дней', s === null ? null : Math.floor(s / 86400)],
    ['Часов', s === null ? null : Math.floor(s / 3600) % 24],
    ['Мин', s === null ? null : Math.floor(s / 60) % 60],
    ['Сек', s === null ? null : s % 60],
  ];

  return (
    <section className="px-page pt-24" aria-label={drop.title}>
      <div className="reveal relative h-[min(46vw,520px)] min-h-[320px] overflow-hidden rounded-sm">
        <PanelView panel={drop.panel} />
        <div className="absolute inset-0 bg-black/45" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white">
          <p className="label-xs opacity-80">{drop.eyebrow}</p>
          <h2 className="title-xl mt-2 max-w-[14ch] text-4xl sm:text-6xl">{drop.title}</h2>
          <div className="mt-6 flex gap-5 sm:gap-8" role="timer" aria-live="off">
            {parts.map(([label, value]) => (
              <div key={label} className="flex flex-col items-center">
                <span key={value} className="title-xl text-3xl tabular-nums sm:text-4xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300">
                  {value === null ? '--' : String(value).padStart(2, '0')}
                </span>
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
          <Link key={c.title + i} href={href(`/collections/${c.slug}`)} className="reveal group w-[70vw] shrink-0 snap-start md:w-auto">
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
      {/* Four photos fill a 2×2 / 4-across grid; otherwise the 3- and 5-across layout. */}
      <div className={cn('mt-8 grid grid-cols-2 gap-3', store.social!.panels.length === 4 ? 'lg:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-5')}>
        {store.social!.panels.map((p, i) => (
          <div key={i} className={cn('reveal group aspect-[4/5] overflow-hidden rounded-sm', i > 3 && 'max-lg:hidden', i > 1 && 'max-sm:hidden')}>
            <PanelView panel={p} className="transition-transform duration-700 group-hover:scale-[1.04]" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Customer reviews (edited in the brand dashboard), all visible at once in a row. */
export function Reviews() {
  const { store } = useStore();
  return (
    <section className="px-page pt-24" aria-labelledby="reviews-title">
      <div className="reveal">
        <p className="label-xs mb-1 text-muted-foreground">Отзывы</p>
        <h2 id="reviews-title" className="title-xl text-2xl sm:text-3xl">
          What they say
        </h2>
      </div>
      <div className="mt-8 grid gap-x-6 gap-y-8 md:grid-cols-3">
        {store.testimonials.map((t, i) => (
          <figure key={i} className="reveal flex flex-col border-t border-border pt-5">
            <blockquote className="flex-1 text-sm leading-relaxed">“{t.quote}”</blockquote>
            <figcaption className="label-xs mt-5">
              <b>{t.author}</b>
              {t.location && <span className="text-muted-foreground"> · {t.location}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
