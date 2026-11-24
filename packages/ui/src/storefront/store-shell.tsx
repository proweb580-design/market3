'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { CartSheet } from './cart-sheet';
import { CartToast } from './cart-toast';
import { Footer } from './footer';
import { Header } from './header';
import { Intro } from './intro';
import { MenuSheet } from './menu-sheet';
import { SearchSheet } from './search-sheet';
import { StoreProvider, useStore } from './store-context';
import type { StoreConfig, StoreProduct } from './types';

function Chrome({ basePath, children }: { basePath: string; children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === basePath || pathname === `${basePath}/`;
  // Web only (IntroScript lives in the web app's <head>): every Mini App launch is a fresh session, so it would replay on top of Telegram's own loader.
  const { variant } = useStore();
  const intro = isHome && variant === 'web';
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-2">
        Перейти к содержимому
      </a>
      <Header overlay={isHome} />
      {intro && <Intro />}
      <main id="main">{children}</main>
      <Footer />
      <MenuSheet />
      <SearchSheet />
      <CartSheet />
      <CartToast />
    </>
  );
}

/** Everything around a storefront page: providers, header, footer, drawers. */
export function StoreShell({
  store,
  products,
  basePath,
  variant = 'web',
  extras,
  children,
}: {
  store: StoreConfig;
  products: StoreProduct[];
  basePath: string;
  variant?: 'web' | 'miniapp';
  /** Host integrations rendered inside the store context (e.g. the Telegram bridge). */
  extras?: ReactNode;
  children: ReactNode;
}) {
  return (
    <StoreProvider store={store} products={products} basePath={basePath} variant={variant}>
      <div className={variant === 'miniapp' ? 'pb-[calc(env(safe-area-inset-bottom)+4rem)]' : undefined}>
        <Chrome basePath={basePath}>{children}</Chrome>
        {extras}
      </div>
    </StoreProvider>
  );
}
