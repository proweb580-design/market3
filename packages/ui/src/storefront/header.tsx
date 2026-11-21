'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Menu, Search, ShoppingBag, User } from 'lucide-react';
import { cn } from '../lib/utils';
import { LogoMark } from './logo-mark';
import { useStore } from './store-context';
import { ThemeToggle } from './theme-toggle';

const iconBtn =
  'relative inline-flex size-9 items-center justify-center rounded-md transition-opacity hover:opacity-60 focus-visible:outline-2 focus-visible:outline-ring';

/** Reference §2.1: burger left, spinning emblem centre, utility icons right. `overlay` floats it over the hero. */
export function Header({ overlay = false }: { overlay?: boolean }) {
  const { store, href, variant, cartCount, wishlist, setOverlay } = useStore();
  const web = variant === 'web';
  const hidden = useHideOnScroll();

  return (
    <header
      className={cn(
        'z-40 w-full transition-transform duration-300 motion-reduce:transition-none',
        overlay
          ? 'fixed inset-x-0 top-0 bg-background/30 backdrop-blur-xl'
          : 'sticky top-0 border-b border-border bg-background',
        hidden && '-translate-y-full',
      )}
    >
      <div className="grid h-header grid-cols-[1fr_auto_1fr] items-center px-page">
        <div className="flex items-center">
          <button type="button" className={cn(iconBtn, '-ml-2')} aria-label="Открыть меню" onClick={() => setOverlay('menu')}>
            <Menu strokeWidth={1.5} className="size-[18px]" />
          </button>
        </div>

        <Link href={href()} aria-label={`${store.name} — главная`} className="flex items-center" draggable={false}>
          <LogoMark className={web ? 'size-9' : 'size-7'} />
        </Link>

        <nav aria-label="Действия" className="-mr-2 flex items-center justify-end gap-0.5">
          <button type="button" className={iconBtn} aria-label="Поиск" onClick={() => setOverlay('search')}>
            <Search strokeWidth={1.5} className="size-4" />
          </button>
          {web && (
            <Link href="/account" className={cn(iconBtn, 'max-md:hidden')} aria-label="Аккаунт">
              <User strokeWidth={1.5} className="size-4" />
            </Link>
          )}
          <Link href={href('/wishlist')} className={cn(iconBtn, 'max-sm:hidden')} aria-label={`Избранное (${wishlist.size})`}>
            <Heart strokeWidth={1.5} className="size-4" />
            {wishlist.size > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-foreground" />}
          </Link>
          {web && (
            <>
              <span aria-hidden className="mx-1.5 h-4 w-px bg-border max-md:hidden" />
              <ThemeToggle className={cn(iconBtn, 'max-md:hidden')} />
            </>
          )}
          <button type="button" className={cn(iconBtn, 'w-auto gap-1 px-2')} aria-label={`Корзина, товаров: ${cartCount}`} onClick={() => setOverlay('cart')}>
            <ShoppingBag strokeWidth={1.5} className="size-4" />
            <span className="text-[11px] tabular-nums">{cartCount}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

/** Hidden while the page scrolls down; back once scrolling stops or goes up. */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > lastY && y > 80);
      lastY = y;
      clearTimeout(timer);
      timer = setTimeout(() => setHidden(false), 250);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, []);
  return hidden;
}
