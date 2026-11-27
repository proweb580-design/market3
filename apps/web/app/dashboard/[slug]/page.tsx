'use client';

import Link from 'next/link';
import { Button } from '@repo/ui/components/ui/button';
import { formatMoney } from '@repo/ui/lib/format';
import { Async, Card, PageHead, STATUS_LABEL, dateTime, roleName, useLoad } from '../kit';
import { useOrg } from '../org-context';

interface OrderRow { id: string; number: number; status: string; currency: string; totalMinor: number; contactEmail: string | null; createdAt: string }

/** The owner's home: what needs doing now, the latest orders, shortcuts. */
export default function Overview() {
  const org = useOrg();
  const base = `/dashboard/${org.slug}`;
  const toShip = useLoad<{ total: number }>(`/organizations/${org.id}/orders?status=PAID&pageSize=1`);
  const unpaid = useLoad<{ total: number }>(`/organizations/${org.id}/orders?status=PENDING_PAYMENT&pageSize=1`);
  const tickets = useLoad<{ open: number }>(`/organizations/${org.id}/support/tickets?pageSize=1`);
  const recent = useLoad<{ items: OrderRow[] }>(`/organizations/${org.id}/orders?pageSize=5`);

  const stats = [
    { label: 'Нужно отправить', value: toShip.data?.total, href: `${base}/orders`, accent: true },
    { label: 'Ждут оплаты', value: unpaid.data?.total, href: `${base}/orders` },
    { label: 'Новые обращения', value: tickets.data?.open, href: `${base}/support`, accent: true },
  ];

  return (
    <>
      <PageHead title={org.name} subtitle={`Вы вошли как: ${roleName(org.role)}`} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-md border border-border p-4 transition-colors hover:bg-muted">
            <p className="label-xs text-muted-foreground">{s.label}</p>
            <p className={`title-xl mt-1 text-4xl ${s.accent && s.value ? '' : 'text-muted-foreground'}`}>{s.value ?? '–'}</p>
          </Link>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button asChild><Link href={`${base}/products/new`}>+ Добавить товар</Link></Button>
        <Button asChild variant="outline"><Link href={`${base}/orders`}>Все заказы</Link></Button>
        <Button asChild variant="outline"><Link href={`${base}/storefront`}>Настроить витрину</Link></Button>
        <Button asChild variant="ghost"><a href={`/s/${org.slug}`} target="_blank" rel="noopener noreferrer">Открыть магазин ↗</a></Button>
      </div>

      <Card title="Последние заказы" actions={<Link href={`${base}/orders`} className="text-xs underline">Все</Link>}>
        <Async state={recent}>
          {({ items }) =>
            items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Заказов пока нет. Они появятся здесь, как только покупатель оформит первый.</p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {items.map((o) => (
                  <li key={o.id}>
                    <Link href={`${base}/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2 hover:underline">
                      <span><b>№{o.number}</b> <span className="text-muted-foreground">{o.contactEmail ?? ''} · {dateTime(o.createdAt)}</span></span>
                      <span className="text-right"><span className="block tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency })}</span><span className={o.status === 'PAID' ? 'font-bold' : 'text-muted-foreground'}>{STATUS_LABEL[o.status] ?? o.status}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>

    </>
  );
}
