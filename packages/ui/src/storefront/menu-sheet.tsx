'use client';

import Link from 'next/link';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../components/ui/sheet';
import { useOverlay, useStore } from './store-context';
import { ThemeToggle } from './theme-toggle';
import { TelegramIconLink } from './telegram-cta';

/** Burger menu. Not opened in the reference video — designed in the same visual language. */
export function MenuSheet() {
  const { store, href, setOverlay, variant } = useStore();
  const overlay = useOverlay();
  const close = () => setOverlay(null);

  return (
    <Sheet open={overlay === 'menu'} onOpenChange={(open) => setOverlay(open ? 'menu' : null)}>
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetTitle className="label-xs px-6 pt-6 font-normal text-muted-foreground">{store.name}</SheetTitle>
        <SheetDescription className="sr-only">Навигация по магазину</SheetDescription>
        <nav className="flex flex-col px-6 pt-8">
          {[...store.footer.menu, { label: 'Избранное', path: '/wishlist' }].map((item) => (
            <Link
              key={item.path + item.label}
              href={href(item.path)}
              onClick={close}
              className="title-xl border-b border-border py-3 text-3xl transition-opacity hover:opacity-60"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between border-t border-border px-6 py-5">
          <div>{variant === 'web' && store.telegramBot && <TelegramIconLink bot={store.telegramBot} className="size-9" />}</div>
          {variant === 'web' && <ThemeToggle className="inline-flex size-8 items-center justify-center" />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
