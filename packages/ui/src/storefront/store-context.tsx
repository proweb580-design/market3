'use client';

import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchWishlist, setWishlisted } from './checkout-client';
import type { StoreConfig, StoreProduct } from './types';

export interface CartLine {
  productSlug: string;
  size: string;
  color: string;
  quantity: number;
}

type Overlay = 'cart' | 'menu' | 'search' | 'player' | null;

/** The page's main call to action (e.g. "Add to cart"). A host such as Telegram can render it natively. */
export interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** What a host app (Telegram Mini App) adds on top of the plain web storefront. */
export interface StoreHost {
  /** Signed-in buyer's access token, if the host has a session. */
  getAuthToken: () => Promise<string | null>;
  /** Opens an external page (the hosted payment page) the host's way. */
  openLink: (url: string) => void;
}

/** The purchasable variant of a product for a chosen size and colour (null if that combination isn't sold). */
export function variantFor(product: StoreProduct, size: string, color: string) {
  const fallbackColor = product.colors[0]?.name;
  return product.variants.find((v) => (v.size ?? 'One size') === size && (v.color ?? fallbackColor) === color) ?? null;
}

interface StoreContextValue {
  store: StoreConfig;
  products: StoreProduct[];
  variant: 'web' | 'miniapp';
  href: (path?: string) => string;
  productBySlug: (slug: string) => StoreProduct | undefined;
  cart: CartLine[];
  addToCart: (line: CartLine) => void;
  /** The last line added (with a timestamp so re-adding the same item shows the toast again). */
  lastAdded: { line: CartLine; at: number } | null;
  setQuantity: (line: CartLine, quantity: number) => void;
  clearCart: () => void;
  host: StoreHost | null;
  setHost: (host: StoreHost | null) => void;
  cartCount: number;
  subtotalMinor: number;
  wishlist: ReadonlySet<string>;
  toggleWishlist: (slug: string) => void;
  /** The open drawer is read with useOverlay(). */
  setOverlay: (overlay: Overlay) => void;
  /** The current primary action is read with usePrimaryAction(). */
  setPrimaryAction: (action: PrimaryAction | null) => void;
  /** True when the host shows primaryAction itself (Telegram MainButton) — pages then hide their own bar. */
  nativePrimary: boolean;
  setNativePrimary: (native: boolean) => void;
}

const StoreContext = createContext<StoreContextValue | null>(null);
// Values that change often get their own contexts: opening a drawer or changing the size on a product page
// then re-renders only their few readers, not every product card that uses the store.
const OverlayContext = createContext<Overlay>(null);
const PrimaryActionContext = createContext<PrimaryAction | null>(null);

const sameLine = (a: CartLine, b: CartLine) =>
  a.productSlug === b.productSlug && a.size === b.size && a.color === b.color;

/**
 * Client state for one storefront. The cart is kept in this browser (localStorage, per store) as variant choices only:
 * prices, stock and totals are always re-computed by the server (quote / checkout), never taken from here.
 * the wishlist is local for guests and on the account (wishlist_items) when signed in.
 */
export function StoreProvider({
  store,
  products,
  basePath,
  variant = 'web',
  children,
}: {
  store: StoreConfig;
  products: StoreProduct[];
  basePath: string;
  variant?: 'web' | 'miniapp';
  children: ReactNode;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastAdded, setLastAdded] = useState<{ line: CartLine; at: number } | null>(null);
  const [host, setHost] = useState<StoreHost | null>(null);
  const loaded = useRef(false);
  const storageKey = `cart:${store.slug}`;
  const [wishlist, setWishlist] = useState<ReadonlySet<string>>(new Set());
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [primaryAction, setPrimaryAction] = useState<PrimaryAction | null>(null);
  const [nativePrimary, setNativePrimary] = useState(false);

  const bySlug = useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);

  // Restore after hydration (never during render), keeping only lines that still match a sellable variant.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as CartLine[];
      const valid = saved.filter((l) => {
        const p = bySlug.get(l.productSlug);
        return p && variantFor(p, l.size, l.color) && Number.isInteger(l.quantity) && l.quantity > 0;
      });
      if (valid.length) setCart(valid.map((l) => ({ ...l, quantity: Math.min(l.quantity, 10) })));
    } catch {
      // storage unavailable or corrupt: start with an empty cart
    }
    loaded.current = true;
  }, [storageKey, bySlug]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {
      // storage blocked: the cart still works for this page view
    }
  }, [cart, storageKey]);

  const clearCart = useCallback(() => setCart([]), []);

  const addToCart = useCallback((line: CartLine) => {
    setCart((lines) =>
      lines.some((l) => sameLine(l, line))
        ? lines.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.min(l.quantity + line.quantity, 10) } : l))
        : [...lines, line],
    );
    setLastAdded({ line, at: Date.now() });
  }, []);

  const setQuantity = useCallback((line: CartLine, quantity: number) => {
    setCart((lines) =>
      quantity <= 0
        ? lines.filter((l) => !sameLine(l, line))
        : lines.map((l) => (sameLine(l, line) ? { ...l, quantity: Math.min(quantity, 10) } : l)),
    );
  }, []);

  // Wishlist: kept in this browser for guests; for a signed-in buyer (host has a token) it lives on the account.
  const wishlistKey = `wishlist:${store.slug}`;
  useEffect(() => {
    let live = true;
    let local: string[] = [];
    try {
      local = (JSON.parse(localStorage.getItem(wishlistKey) ?? '[]') as string[]).filter((s) => bySlug.has(s));
    } catch {
      // storage unavailable: start empty
    }
    setWishlist(new Set(local));
    if (!host) return;
    void (async () => {
      const token = await host.getAuthToken();
      if (!token || !live) return;
      try {
        const { slugs } = await fetchWishlist(store.slug, token);
        // Items hearted while signed out move to the account.
        for (const s of local.filter((s) => !slugs.includes(s))) await setWishlisted(store.slug, s, true, token).catch(() => undefined);
        if (live) setWishlist(new Set([...slugs, ...local]));
        localStorage.removeItem(wishlistKey);
      } catch {
        // account wishlist unavailable: keep the local one
      }
    })();
    return () => {
      live = false;
    };
  }, [host, store.slug, wishlistKey, bySlug]);

  const toggleWishlist = useCallback(
    (slug: string) => {
      const on = !wishlist.has(slug);
      const next = new Set(wishlist);
      if (on) next.add(slug);
      else next.delete(slug);
      setWishlist(next);
      void (async () => {
        const token = await host?.getAuthToken();
        if (token) {
          await setWishlisted(store.slug, slug, on, token).catch(() => setWishlist(wishlist)); // roll back if the server refused
          return;
        }
        try {
          localStorage.setItem(wishlistKey, JSON.stringify([...next]));
        } catch {
          // storage blocked: the heart still works for this page view
        }
      })();
    },
    [wishlist, host, store.slug, wishlistKey],
  );

  // Stable between renders, so effects that depend on them (e.g. the Telegram Back button) don't re-run on every cart change.
  const href = useCallback((path = '') => `${basePath}${path}` || '/', [basePath]);
  const productBySlug = useCallback((slug: string) => bySlug.get(slug), [bySlug]);

  const value = useMemo<StoreContextValue>(() => {
    const subtotalMinor = cart.reduce(
      (sum, l) => sum + (bySlug.get(l.productSlug)?.price.amountMinor ?? 0) * l.quantity,
      0,
    );
    return {
      store,
      products,
      variant,
      href,
      productBySlug,
      cart,
      addToCart,
      lastAdded,
      setQuantity,
      clearCart,
      host,
      setHost,
      cartCount: cart.reduce((n, l) => n + l.quantity, 0),
      subtotalMinor,
      wishlist,
      toggleWishlist,
      setOverlay,
      setPrimaryAction,
      nativePrimary,
      setNativePrimary,
    };
  }, [store, products, variant, href, productBySlug, bySlug, cart, addToCart, lastAdded, setQuantity, clearCart, host, wishlist, toggleWishlist, nativePrimary]);

  return (
    <StoreContext value={value}>
      <OverlayContext value={overlay}>
        <PrimaryActionContext value={primaryAction}>{children}</PrimaryActionContext>
      </OverlayContext>
    </StoreContext>
  );
}

export function useStore() {
  const ctx = use(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

/** Which drawer is open (cart, menu, search…). */
export const useOverlay = () => use(OverlayContext);

/** The page's main call to action, for a host that renders it natively. */
export const usePrimaryAction = () => use(PrimaryActionContext);
