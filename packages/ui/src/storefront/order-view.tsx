'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { formatMoney } from '../lib/format';
import { CheckoutError, fetchOrder, type BuyerOrder } from './checkout-client';
import { useStore } from './store-context';

const HEADLINE: Record<BuyerOrder['status'], { title: string; text: string }> = {
  PENDING_PAYMENT: { title: 'Ожидаем оплату', text: 'Оплата ещё не поступила. Страница обновится автоматически.' },
  PAID: { title: 'Спасибо — заказ подтверждён', text: 'Оплата получена, мы начинаем собирать ваш заказ.' },
  FULFILLED: { title: 'Заказ отправлен', text: 'Ваш заказ передан в доставку.' },
  CANCELED: { title: 'Заказ отменён', text: 'Заказ не был оплачен вовремя или был отменён. Деньги не списаны.' },
  REFUNDED: { title: 'Деньги возвращены', text: 'Оплата за заказ возвращена.' },
};

/** Buyer's order page: opened from the payment page's return link (token in the URL) or by the signed-in buyer. */
export function OrderView({ orderId }: { orderId: string }) {
  const { store, href, host, clearCart } = useStore();
  const search = useSearchParams();
  const token = search.get('token');
  const justPaid = search.get('result') === 'success';
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const load = async () => {
      try {
        const authToken = (await host?.getAuthToken()) ?? null;
        const next = await fetchOrder(store.slug, orderId, token, authToken);
        if (cancelled) return;
        setOrder(next);
        setError(null);
        // Payment pages can take a moment to confirm: poll for a couple of minutes while it is unpaid.
        if (next.status === 'PENDING_PAYMENT' && justPaid && attempts++ < 30) timer = setTimeout(load, 4000);
      } catch (e) {
        if (!cancelled) setError(e instanceof CheckoutError && e.status === 404 ? 'Мы не нашли этот заказ. Откройте ссылку из подтверждения оплаты.' : 'Не удалось загрузить заказ. Попробуйте ещё раз.');
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [store.slug, orderId, token, justPaid, host]);

  const paid = order?.status === 'PAID' || order?.status === 'FULFILLED';
  useEffect(() => {
    if (paid) clearCart();
  }, [paid, clearCart]);

  if (error) {
    return (
      <div role="alert" className="px-page py-24 text-center">
        <p className="text-sm">{error}</p>
        <Button asChild className="mt-6"><Link href={href()}>Вернуться в магазин</Link></Button>
      </div>
    );
  }
  if (!order) return <p className="px-page py-24 text-center text-xs text-muted-foreground" aria-busy="true">Загружаем заказ…</p>;

  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: order.currency });
  const head = HEADLINE[order.status];
  const a = order.shippingAddress;
  const address = a && [a.name, a.line1, a.line2, [a.postalCode, a.city].join(' '), a.region, a.country].filter(Boolean).join(', ');
  return (
    <div className="mx-auto max-w-xl px-page py-16">
      <p className="label-xs text-muted-foreground">Заказ №{order.number}</p>
      <h1 className="title-xl mt-1 text-4xl">{head.title}</h1>
      <p className="mt-2 text-xs text-muted-foreground">{head.text}</p>
      {order.contactEmail && <p className="mt-1 text-xs text-muted-foreground">Уведомления придут на {order.contactEmail}.</p>}

      {order.payUrl && (
        <Button className="mt-6" onClick={() => (host ? host.openLink(order.payUrl!) : window.location.assign(order.payUrl!))}>
          Перейти к оплате
        </Button>
      )}

      <section aria-label="Чек" className="mt-8 rounded-lg border border-border p-6">
        <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-border pb-4">
          <p className="label-xs font-bold">{paid ? 'Кассовый чек' : 'Счёт'}</p>
          <p className="label-xs text-muted-foreground">{store.name}</p>
        </div>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
          <Row label="Заказ">№{order.number}</Row>
          <Row label="Оформлен">{when(order.createdAt)}</Row>
          {order.paidAt && <Row label="Оплачен">{when(order.paidAt)}</Row>}
          <Row label="Статус">{STATUS[order.status]}</Row>
          {order.paymentProvider && <Row label="Оплата">Банковская карта · {order.paymentProvider === 'stripe' ? 'Stripe' : order.paymentProvider}</Row>}
          {order.contactEmail && <Row label="Эл. почта">{order.contactEmail}</Row>}
          {address && <Row label="Доставка">{address}</Row>}
        </dl>

        <ul className="mt-4 divide-y divide-border border-y border-dashed border-border">
          {order.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-3 py-3 text-xs">
              <span>
                {i.productTitle}
                <span className="block text-muted-foreground">{i.variantTitle} · {i.quantity} × {money(i.unitPriceMinor)}</span>
              </span>
              <span className="tabular-nums">{money(i.totalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-1 text-xs">
          <div className="flex justify-between"><dt className="text-muted-foreground">Сумма</dt><dd className="tabular-nums">{money(order.subtotalMinor)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd className="tabular-nums">{order.shippingMinor === 0 ? 'Бесплатно' : money(order.shippingMinor)}</dd></div>
          <div className="flex justify-between text-sm font-bold"><dt>{paid ? 'Оплачено' : 'К оплате'}</dt><dd className="tabular-nums">{money(order.totalMinor)}</dd></div>
        </dl>
      </section>

      <div className="mt-8 flex flex-wrap gap-3 print:hidden">
        <Button asChild variant="outline"><Link href={href()}>Продолжить покупки</Link></Button>
        {!host && <Button variant="outline" onClick={() => window.print()}>Распечатать чек</Button>}
        {!host && <Button asChild variant="ghost"><Link href="/account">Все заказы</Link></Button>}
      </div>
    </div>
  );
}

const STATUS: Record<BuyerOrder['status'], string> = { PENDING_PAYMENT: 'Ожидает оплаты', PAID: 'Оплачен', FULFILLED: 'Отправлен', CANCELED: 'Отменён', REFUNDED: 'Возвращён' };

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </>
  );
}
