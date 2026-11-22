import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { CollectionView } from './collection-view';
import { getCollection, getProduct, getProducts, getStore } from './api';
import { HomeView } from './home-view';
import { LookbookView } from './lookbook-view';
import { OrderView } from './order-view';
import { ProductView } from './product-view';
import { PageSkeleton, ShellSkeleton } from './skeletons';
import { StoreShell } from './store-shell';
import { WishlistView } from './wishlist-view';

/**
 * Route bodies shared by apps/web (/s/[store]) and apps/mini-app (/[store]).
 * Each awaits its params inside <Suspense> so client navigations stay instant (Next 16 cache components).
 * Data comes from the public storefront API (see ./api). No generateStaticParams: stores are created at runtime,
 * so pages render on request from cached API reads, and builds never depend on the API being reachable.
 */

type StoreParams = Promise<{ store: string }>;
type ItemParams = Promise<{ store: string; slug: string }>;

async function StoreLayoutBody({
  params,
  basePath,
  variant,
  extras,
  children,
}: {
  params: StoreParams;
  basePath: (store: string) => string;
  variant: 'web' | 'miniapp';
  extras?: ReactNode;
  children: ReactNode;
}) {
  const { store: slug } = await params;
  // Both reads at once: one after the other they doubled the wait whenever the cache was cold.
  const [store, products] = await Promise.all([getStore(slug), getProducts(slug)]);
  if (!store) notFound();
  return (
    <StoreShell store={store} products={products} basePath={basePath(slug)} variant={variant} extras={extras}>
      {children}
    </StoreShell>
  );
}

export function StoreLayoutRoute(props: Parameters<typeof StoreLayoutBody>[0]) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <StoreLayoutBody {...props} />
    </Suspense>
  );
}

async function HomeBody({ params }: { params: StoreParams }) {
  const { store: slug } = await params;
  const store = await getStore(slug);
  if (!store) notFound();
  const grid = store.grid && (await getCollection(slug, store.grid.collection));
  return <HomeView gridProducts={grid?.products ?? []} />;
}

async function CollectionBody({ params }: { params: ItemParams }) {
  const { store, slug } = await params;
  const collection = await getCollection(store, slug);
  if (!collection) notFound();
  return <CollectionView title={collection.title} products={collection.products} />;
}

async function ProductBody({ params }: { params: ItemParams }) {
  const { store, slug } = await params;
  const product = await getProduct(store, slug);
  if (!product) notFound();
  const context = product.collections.at(-1);
  const collection = (context && (await getCollection(store, context))) || { slug: '', title: 'Все товары', products: await getProducts(store) };
  return (
    <ProductView
      product={product}
      collection={{ slug: collection.slug, title: collection.title }}
      related={collection.products.filter((p) => p.slug !== slug)}
    />
  );
}

export const OrderRoute = ({ params }: { params: Promise<{ store: string; orderId: string }> }) => (
  <Suspense fallback={<PageSkeleton />}>
    <OrderBody params={params} />
  </Suspense>
);

async function OrderBody({ params }: { params: Promise<{ store: string; orderId: string }> }) {
  const { orderId } = await params;
  // useSearchParams (the order token) needs its own boundary.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrderView orderId={orderId} />
    </Suspense>
  );
}

export const HomeRoute = ({ params }: { params: StoreParams }) => (
  <Suspense fallback={<PageSkeleton />}>
    <HomeBody params={params} />
  </Suspense>
);

export const CollectionRoute = ({ params }: { params: ItemParams }) => (
  <Suspense fallback={<PageSkeleton />}>
    <CollectionBody params={params} />
  </Suspense>
);

export const ProductRoute = ({ params }: { params: ItemParams }) => (
  <Suspense fallback={<PageSkeleton variant="product" />}>
    <ProductBody params={params} />
  </Suspense>
);

async function LookbookBody({ params }: { params: StoreParams }) {
  const { store: slug } = await params;
  if (!(await getStore(slug))?.lookbook) notFound();
  return <LookbookView />;
}

export const LookbookRoute = ({ params }: { params: StoreParams }) => (
  <Suspense fallback={<PageSkeleton />}>
    <LookbookBody params={params} />
  </Suspense>
);
export const WishlistRoute = () => <WishlistView />;

export async function productTitle(params: ItemParams) {
  const { store, slug } = await params;
  return (await getProduct(store, slug))?.title;
}

export async function collectionTitle(params: ItemParams) {
  const { store, slug } = await params;
  return (await getCollection(store, slug))?.title;
}
