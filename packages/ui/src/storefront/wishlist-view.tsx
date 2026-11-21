'use client';

import Link from 'next/link';
import { ProductCard } from './product-card';
import { useStore } from './store-context';

/** Not in the reference: wishlist grid in the same visual language. */
export function WishlistView() {
  const { products, wishlist, href } = useStore();
  const items = products.filter((p) => wishlist.has(p.slug));
  return (
    <div className="px-page pt-10">
      <h1 className="title-xl text-4xl sm:text-6xl">Wishlist</h1>
      <p className="label-xs mt-2 text-muted-foreground">Сохранено: {items.length}</p>
      {items.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-sm text-muted-foreground">Нажмите на сердечко у товара, чтобы сохранить его здесь.</p>
          <Link href={href(`/collections/fw26`)} className="label-xs mt-4 inline-block font-bold underline">
            Смотреть коллекцию
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
