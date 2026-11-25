'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton } from '@repo/ui/components/ui/skeleton';
import { formatMoney } from '@repo/ui/lib/format';
import { api, ApiError } from '../../lib/api';

export interface Me {
  id: string;
  email: string | null;
  profile: { displayName: string | null; phone: string | null; locale: string } | null;
  telegramAccount: { username: string | null; linkedAt: string } | null;
  organizations: { id: string; slug: string; name: string; role: { key: string; name: string } }[];
  isSuperAdmin: boolean;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.');

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="label-xs mb-4 font-bold">{title}</h2>
      {children}
    </section>
  );
}

// ───────────── orders ─────────────

interface OrderRow {
  id: string;
  number: number;
  status: string;
  currency: string;
  totalMinor: number;
  createdAt: string;
  itemCount: number;
  store: { slug: string; name: string };
}

const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Ожидает оплаты', PAID: 'Оплачен', FULFILLED: 'Отправлен', CANCELED: 'Отменён', REFUNDED: 'Возвращён' };

export function OrdersSkeleton() {
  return (
    <ul className="divide-y divide-border" aria-busy="true" aria-label="Загружаем заказы">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-4 py-3">
          <span className="flex flex-col gap-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </span>
          <span className="flex flex-col items-end gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Orders() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Guest orders placed with this (verified) email join the account first.
    api('/users/me/orders/claim', { method: 'POST' })
      .catch(() => undefined)
      .then(() => api<{ items: OrderRow[] }>('/users/me/orders?pageSize=50'))
      .then((page) => live && setOrders(page.items))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>;
  if (!orders) return <OrdersSkeleton />;
  if (orders.length === 0) return <p className="text-xs text-muted-foreground">Заказов пока нет.</p>;
  return (
    <ul className="divide-y divide-border">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/s/${o.store.slug}/orders/${o.id}`} className="flex items-center justify-between gap-4 py-3 text-xs hover:opacity-70">
            <span>
              <span className="font-bold">{o.store.name} · №{o.number}</span>
              <span className="block text-muted-foreground">{new Date(o.createdAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })} · {o.itemCount} шт. · {STATUS_LABEL[o.status] ?? o.status}</span>
            </span>
            <span className="text-right">
              <span className="block tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency })}</span>
              <span className="text-muted-foreground">{o.status === 'PENDING_PAYMENT' ? 'Оплатить →' : 'Чек →'}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
