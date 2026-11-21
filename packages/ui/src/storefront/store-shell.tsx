'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { CartSheet } from './cart-sheet';
import { Footer } from './footer';
import { Header } from './header';
import { MenuSheet } from './menu-sheet';
import { SearchSheet } from './search-sheet';
import { StoreProvider } from './store-context';
import type { StoreConfig, StoreProduct } from './types';

function Chrome({ basePath, children }: { basePath: string; children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === basePath || pathname === `${basePath}/`;
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-2">
        Перейти к содержимому
      </a>
      <Header overlay={isHome} />
      <main id="main">{children}</main>
      <Footer />
      <MenuSheet />
      <SearchSheet />
      <CartSheet />
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
