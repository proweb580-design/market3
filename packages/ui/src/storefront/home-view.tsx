'use client';

import {
  CollectionsRow,
  DropCountdown,
  FeaturedCarousel,
  HeroBanner,
  ProductGridSection,
  SocialFeed,
} from './home-sections';
import { useStore } from './store-context';
import type { StoreProduct } from './types';

/** Home page in reference order (§1 timeline): hero → featured → grid → drop → collections → social; reviews live in the footer. */
export function HomeView({ gridProducts }: { gridProducts: StoreProduct[] }) {
  const { store } = useStore();
  return (
    <>
      {store.hero && <HeroBanner />}
      {store.featured && <FeaturedCarousel />}
      {store.grid && <ProductGridSection title={store.grid.title} products={gridProducts.slice(0, 8)} viewAllPath={`/collections/${store.grid.collection}`} />}
      {store.drop && <DropCountdown />}
      {store.collections.length > 0 && <CollectionsRow />}
      {store.social && <SocialFeed />}
    </>
  );
}
