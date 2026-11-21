'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Search } from 'lucide-react';
import { formatMoney } from '../lib/format';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../components/ui/sheet';
import { ProductImage } from './media';
import { useStore } from './store-context';

/** Search overlay. shortcut: filters the loaded catalogue client-side; phase 8 queries the API. */
export function SearchSheet() {
  const { products, href, overlay, setOverlay } = useStore();
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  const results = q ? products.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <Sheet open={overlay === 'search'} onOpenChange={(open) => setOverlay(open ? 'search' : null)}>
      <SheetContent side="top" className="gap-0 px-page pb-8 pt-6">
        <SheetTitle className="label-xs font-normal text-muted-foreground">Поиск</SheetTitle>
        <SheetDescription className="sr-only">Поиск товаров по названию</SheetDescription>
        <label className="mt-4 flex items-center gap-3 border-b border-foreground pb-3">
          <Search strokeWidth={1.5} className="size-5 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что вы ищете?"
            className="title-xl w-full bg-transparent text-2xl outline-none placeholder:text-muted-foreground sm:text-4xl"
          />
        </label>
        {q && (
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {results.map((p) => (
              <li key={p.slug}>
                <Link href={href(`/products/${p.slug}`)} onClick={() => setOverlay(null)} className="group block">
                  <ProductImage media={p.media[0]!} tone={p.colors[0]!.hex} className="transition-transform group-hover:scale-105" />
                  <p className="label-xs mt-2 font-bold">{p.title}</p>
                  <p className="label-xs text-muted-foreground">{formatMoney(p.price)}</p>
                </Link>
              </li>
            ))}
            {results.length === 0 && <li className="col-span-full text-sm text-muted-foreground">По запросу «{query}» ничего не найдено.</li>}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
