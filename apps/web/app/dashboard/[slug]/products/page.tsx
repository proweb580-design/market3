'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { formatMoney } from '@repo/ui/lib/format';
import { Async, PRODUCT_STATUS, PageHead, Select, TextField, useLoad } from '../../kit';
import { Thumb, type MediaItem } from '../../media-lib';
import { useOrg } from '../../org-context';

interface Row {
  id: string;
  slug: string;
  title: string;
  status: string;
  variantCount: number;
  stock: number;
  priceMinor: number | null;
  cover: MediaItem | null;
}

export default function ProductsPage() {
  const org = useOrg();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({ pageSize: '100', ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString();
  const list = useLoad<{ items: Row[]; total: number }>(`/organizations/${org.id}/products?${query}`);

  return (
    <>
      <PageHead title="Товары" actions={<Button asChild><Link href={`/dashboard/${org.slug}/products/new`}>+ Добавить товар</Link></Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label="Поиск" value={q} onChange={setQ} placeholder="Название" />
        <Select label="Статус" value={status} onChange={setStatus} options={[{ value: '', label: 'Все' }, ...Object.entries(PRODUCT_STATUS).map(([value, label]) => ({ value, label }))]} />
      </div>
      <Async state={list}>
        {({ items, total }) =>
          items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Товаров не найдено.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/dashboard/${org.slug}/products/${p.id}`} className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted">
                      {p.cover ? <Thumb media={p.cover} className="size-10" /> : <span className="size-10 rounded-sm bg-muted" />}
                      <span className="min-w-0 flex-1"><b className="block truncate">{p.title}</b><span className="text-muted-foreground">{PRODUCT_STATUS[p.status] ?? p.status} · вариантов: {p.variantCount} · <span className={p.stock === 0 ? 'font-bold text-destructive' : ''}>{p.stock === 0 ? 'нет в наличии' : `в наличии: ${p.stock}`}</span></span></span>
                      <span className="tabular-nums">{p.priceMinor === null ? '' : `от ${formatMoney({ amountMinor: p.priceMinor, currency: org.currency })}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Всего: {total}</p>
            </>
          )
        }
      </Async>
    </>
  );
}
