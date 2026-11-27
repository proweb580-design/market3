'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatMoney } from '@repo/ui/lib/format';
import { Async, PageHead, SOURCE_LABEL, STATUS_LABEL, Select, TextField, dateTime, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Row {
  id: string;
  number: number;
  status: string;
  currency: string;
  totalMinor: number;
  contactEmail: string | null;
  createdAt: string;
  source: string;
}

export default function OrdersPage() {
  const org = useOrg();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ pageSize: '100', ...(status ? { status } : {}), ...(q ? { q } : {}) }).toString();
  const list = useLoad<{ items: Row[]; total: number }>(`/organizations/${org.id}/orders?${query}`);

  return (
    <>
      <PageHead title="Заказы" subtitle="Оплаченные заказы ждут отправки — откройте заказ и отметьте «Отправлен»." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Статус" value={status} onChange={setStatus} options={[{ value: '', label: 'Все' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
        <TextField label="Поиск" value={q} onChange={setQ} placeholder="1001 или email" />
      </div>
      <Async state={list}>
        {({ items, total }) =>
          items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Заказов не найдено.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dashboard/${org.slug}/orders/${o.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-muted">
                      <span><b>№{o.number}</b> <span className="text-muted-foreground">{o.contactEmail ?? 'без email'} · {dateTime(o.createdAt)} · {SOURCE_LABEL[o.source] ?? o.source}</span></span>
                      <span className="text-right"><span className="block tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency })}</span><span className={o.status === 'PAID' ? 'font-bold' : 'text-muted-foreground'}>{STATUS_LABEL[o.status] ?? o.status}</span></span>
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
