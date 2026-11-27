'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatMoney } from '@repo/ui/lib/format';
import { api } from '../../../../../lib/api';
import { ActionButton, Async, Card, PAYMENT_LABEL, PageHead, SOURCE_LABEL, STATUS_LABEL, dateTime, useLoad } from '../../../kit';
import { useOrg } from '../../../org-context';

interface OrderDto {
  id: string;
  number: number;
  status: string;
  currency: string;
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  contactEmail: string | null;
  contactPhone: string | null;
  note: string | null;
  source: string;
  paymentStatus: string | null;
  createdAt: string;
  paidAt: string | null;
  shippingAddress: { name?: string; line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string } | null;
  items: { productTitle: string; variantTitle: string; unitPriceMinor: number; quantity: number; totalMinor: number }[];
}

export default function OrderPage() {
  const org = useOrg();
  const { id } = useParams<{ id: string }>();
  const order = useLoad<OrderDto>(`/organizations/${org.id}/orders/${id}`);
  const act = (action: 'fulfill' | 'cancel') => async () => {
    order.setData(await api<OrderDto>(`/organizations/${org.id}/orders/${id}/${action}`, { method: 'POST' }));
  };

  return (
    <Async state={order}>
      {(o) => {
        const money = (n: number) => formatMoney({ amountMinor: n, currency: o.currency });
        const a = o.shippingAddress;
        return (
          <>
            <PageHead
              title={`Заказ №${o.number}`}
              subtitle={`${STATUS_LABEL[o.status] ?? o.status} · ${dateTime(o.createdAt)} · через ${SOURCE_LABEL[o.source] ?? o.source}`}
              actions={
                <>
                  {o.status === 'PAID' && <ActionButton run={act('fulfill')}>Отметить как отправленный</ActionButton>}
                  {o.status === 'PENDING_PAYMENT' && <ActionButton variant="outline" confirm="Отменить неоплаченный заказ и вернуть товары на склад?" run={act('cancel')}>Отменить заказ</ActionButton>}
                </>
              }
            />
            {o.status === 'PAID' && <p className="mb-4 text-xs text-muted-foreground">Заказ оплачен — соберите и отправьте его, затем нажмите «Отметить как отправленный». Возврат оплаченного заказа делается через поддержку платформы.</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Покупатель">
                <p className="text-xs">{o.contactEmail}{o.contactPhone ? ` · ${o.contactPhone}` : ''}</p>
                {a && <address className="mt-2 text-xs not-italic text-muted-foreground">{a.name}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.postalCode} {a.city}{a.region ? `, ${a.region}` : ''}<br />{a.country}</address>}
                {o.note && <p className="mt-2 text-xs">Комментарий: {o.note}</p>}
              </Card>
              <Card title="Оплата"><p className="text-xs">{o.paymentStatus ? (PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus) : 'нет оплаты'}{o.paidAt ? ` · ${dateTime(o.paidAt)}` : ''}</p></Card>
            </div>
            <Card title="Товары">
              <ul className="divide-y divide-border text-xs">
                {o.items.map((i, n) => <li key={n} className="flex justify-between py-2"><span>{i.productTitle} · {i.variantTitle} × {i.quantity}</span><span className="tabular-nums">{money(i.totalMinor)}</span></li>)}
              </ul>
              <dl className="mt-3 flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Товары</dt><dd className="tabular-nums">{money(o.subtotalMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Доставка</dt><dd className="tabular-nums">{money(o.shippingMinor)}</dd></div>
                <div className="flex justify-between font-bold"><dt>Итого</dt><dd className="tabular-nums">{money(o.totalMinor)}</dd></div>
              </dl>
            </Card>
            <Link href={`/dashboard/${org.slug}/orders`} className="text-xs underline">← Все заказы</Link>
          </>
        );
      }}
    </Async>
  );
}
