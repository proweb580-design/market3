'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Grid2x2, Grid3x3, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { Switch } from '../components/ui/switch';
import { ProductCard } from './product-card';
import type { StoreProduct } from './types';

const SORTS = {
  featured: 'Рекомендуемые',
  'price-asc': 'Цена: по возрастанию',
  'price-desc': 'Цена: по убыванию',
  'title-asc': 'По алфавиту, А–Я',
} as const;
type SortKey = keyof typeof SORTS;

const GENDERS = [
  ['all', 'Все'],
  ['woman', 'Женское'],
  ['man', 'Мужское'],
] as const;

/**
 * Reference §2.10: title + count, gender tabs, size filter, sort / in-stock / filter / density toolbar.
 * shortcut: filters the products already loaded for the page; phase 8 moves filtering to API query params.
 */
export function CollectionView({ title, products }: { title: string; products: StoreProduct[] }) {
  const [gender, setGender] = useState<(typeof GENDERS)[number][0]>('all');
  const [size, setSize] = useState<string | null>(null);
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState<SortKey>('featured');
  const [dense, setDense] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const sizes = useMemo(() => [...new Set(products.flatMap((p) => p.sizes.map((s) => s.label)))], [products]);

  const visible = useMemo(() => {
    const list = products.filter((p) => {
      if (gender !== 'all' && p.gender !== gender && p.gender !== 'unisex') return false;
      const pool = size ? p.sizes.filter((s) => s.label === size) : p.sizes;
      if (size && pool.length === 0) return false;
      if (inStock && !pool.some((s) => s.inStock)) return false;
      return true;
    });
    if (sort === 'price-asc') list.sort((a, b) => a.price.amountMinor - b.price.amountMinor);
    if (sort === 'price-desc') list.sort((a, b) => b.price.amountMinor - a.price.amountMinor);
    if (sort === 'title-asc') list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [products, gender, size, inStock, sort]);

  const tab = 'label-xs pb-1 transition-colors';

  return (
    <div className="px-page pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-6">
        <div>
          <h1 className="title-xl text-4xl sm:text-6xl">{title}</h1>
          <p className="label-xs mt-2 text-muted-foreground">Товаров: {visible.length}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="label-xs relative flex items-center gap-1">
            <span className="text-muted-foreground">Сортировка</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="label-xs cursor-pointer appearance-none bg-transparent pr-4 font-bold outline-none"
            >
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 size-3" />
          </label>
          <label className="label-xs flex items-center gap-2">
            В наличии
            <Switch checked={inStock} onCheckedChange={setInStock} aria-label="Только в наличии" />
          </label>
          <button type="button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} className="label-xs flex items-center gap-1.5 hover:opacity-60">
            <SlidersHorizontal className="size-3.5" /> Фильтр
          </button>
          <div className="flex items-center gap-1 max-sm:hidden" role="group" aria-label="Плотность сетки">
            <button type="button" aria-pressed={dense} aria-label="Четыре колонки" onClick={() => setDense(true)} className={cn('p-1', !dense && 'opacity-40')}>
              <Grid3x3 className="size-4" />
            </button>
            <button type="button" aria-pressed={!dense} aria-label="Две колонки" onClick={() => setDense(false)} className={cn('p-1', dense && 'opacity-40')}>
              <Grid2x2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {filtersOpen && (
        <div className="flex flex-col gap-3 border-b border-border py-4 animate-in fade-in slide-in-from-top-1">
          <div className="flex gap-5" role="tablist" aria-label="Пол">
            {GENDERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={gender === key}
                onClick={() => setGender(key)}
                className={cn(tab, gender === key ? 'border-b border-foreground font-bold' : 'text-muted-foreground hover:text-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="label-xs text-muted-foreground">Размер</span>
            {sizes.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                onClick={() => setSize(size === s ? null : s)}
                className={cn(tab, size === s ? 'border-b border-foreground font-bold' : 'text-muted-foreground hover:text-foreground')}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-24 text-center text-sm text-muted-foreground">Нет товаров под выбранные фильтры.</p>
      ) : (
        <div className={cn('mt-8 grid grid-cols-2 gap-x-4 gap-y-10', dense ? 'md:grid-cols-3 lg:grid-cols-4' : 'sm:grid-cols-2 lg:mx-auto lg:max-w-5xl')}>
          {visible.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
