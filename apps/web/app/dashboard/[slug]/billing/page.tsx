'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { formatMoney } from '@repo/ui/lib/format';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, FEATURE_LABEL, PAYMENT_LABEL, PageHead, SUBSCRIPTION_LABEL, date, dateTime, errText, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
  features: Record<string, { enabled: boolean; limit: number | null }>;
}
interface Current {
  plan: { code: string; name: string } | null;
  subscription: { status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; trialEndsAt: string | null } | null;
  usage: Record<string, number>;
  features: Record<string, { enabled: boolean; limit: number | null }>;
}
interface PaymentRow { id: string; status: string; amountMinor: number; currency: string; createdAt: string }

/** After paying at the provider the buyer lands here with ?payment=…: ask the API to check the result right away. */
function ReturnNotice({ onDone }: { onDone: () => void }) {
  const org = useOrg();
  const params = useSearchParams();
  const payment = params.get('payment');
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!payment) return;
    let live = true;
    api<{ status: string }>(`/organizations/${org.id}/payments/${payment}/sync`, { method: 'POST' })
      .then((p) => {
        if (!live) return;
        setText(p.status === 'SUCCEEDED' ? 'Оплата получена — тариф активен.' : p.status === 'PENDING' ? 'Ждём подтверждения оплаты.' : `Оплата: ${PAYMENT_LABEL[p.status] ?? p.status}.`);
        onDone();
      })
      .catch((e: unknown) => live && setText(errText(e)));
    return () => {
      live = false;
    };
  }, [payment, org.id, onDone]);

  return text ? <p role="status" className="mb-4 rounded-md border border-border p-3 text-xs">{text}</p> : null;
}

function Page() {
  const org = useOrg();
  const current = useLoad<Current>(`/organizations/${org.id}/subscription`);
  const plans = useLoad<Plan[]>('/plans');
  const payments = useLoad<{ items: PaymentRow[] }>(`/organizations/${org.id}/payments?pageSize=10`);
  const reload = () => { void current.reload(); void payments.reload(); };

  const buy = (code: string) => async () => {
    const res = await api<{ checkoutUrl: string }>(`/organizations/${org.id}/subscription/checkout`, { method: 'POST', body: { planCode: code } });
    window.location.assign(res.checkoutUrl);
  };

  return (
    <>
      <PageHead title="Тариф" />
      <ReturnNotice onDone={reload} />
      <Card title="Текущий тариф">
        <Async state={current}>
          {(c) => (
            <div className="flex flex-col items-start gap-2 text-xs">
              <p><b>{c.plan?.name ?? 'Не выбран'}</b>{c.subscription ? ` · ${SUBSCRIPTION_LABEL[c.subscription.status] ?? c.subscription.status}` : ''}</p>
              {c.subscription && c.plan?.code !== 'FREE' && (
                <p className="text-muted-foreground">Действует до {date(c.subscription.currentPeriodEnd)}{c.subscription.trialEndsAt ? ` · пробный период до ${date(c.subscription.trialEndsAt)}` : ''}. Тариф оплачивается за период и сам не продлевается.</p>
              )}
              {c.subscription && c.plan?.code !== 'FREE' && (c.subscription.cancelAtPeriodEnd
                ? <ActionButton variant="outline" run={async () => { await api(`/organizations/${org.id}/subscription/resume`, { method: 'POST' }); await current.reload(); }}>Оставить тариф</ActionButton>
                : <ActionButton variant="outline" confirm="Перейти на бесплатный тариф после окончания периода?" run={async () => { await api(`/organizations/${org.id}/subscription/cancel`, { method: 'POST' }); await current.reload(); }}>Отменить после периода</ActionButton>)}
            </div>
          )}
        </Async>
      </Card>

      <Card title="Тарифы">
        <Async state={plans}>
          {(list) => (
            <ul className="grid gap-4 md:grid-cols-2">
              {list.map((p) => {
                const here = current.data?.plan?.code === p.code;
                return (
                  <li key={p.id} className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
                    <p className="flex justify-between"><b>{p.name}</b><span className="tabular-nums">{p.priceMinor === 0 ? 'Бесплатно' : `${formatMoney({ amountMinor: p.priceMinor, currency: p.currency })} / ${p.interval === 'YEAR' ? 'год' : 'мес'}`}</span></p>
                    {p.description && <p className="text-muted-foreground">{p.description}</p>}
                    <ul className="text-muted-foreground">
                      {Object.entries(p.features).filter(([, f]) => f.enabled).map(([key, f]) => (
                        <li key={key}>✓ {FEATURE_LABEL[key] ?? key}{f.limit !== null && f.limit !== undefined ? `: ${f.limit}` : ''}</li>
                      ))}
                    </ul>
                    {p.priceMinor > 0 && (
                      <span className="mt-auto flex gap-2">
                        {p.trialDays > 0 && !here && <ActionButton variant="outline" run={async () => { await api(`/organizations/${org.id}/subscription/trial`, { method: 'POST', body: { planCode: p.code } }); await current.reload(); }}>{p.trialDays} дней бесплатно</ActionButton>}
                        <ActionButton run={buy(p.code)}>{here ? 'Продлить' : 'Выбрать'}</ActionButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
        <p className="mt-3 text-[11px] text-muted-foreground">Пока платформа не включила настоящие платежи, оплата работает в тестовом режиме.</p>
      </Card>

      <Card title="Последние платежи">
        <Async state={payments}>
          {({ items }) => items.length === 0 ? <p className="text-xs text-muted-foreground">Платежей пока нет.</p> : (
            <ul className="divide-y divide-border text-xs">
              {items.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{dateTime(p.createdAt)} · {PAYMENT_LABEL[p.status] ?? p.status}</span><span className="tabular-nums">{formatMoney({ amountMinor: p.amountMinor, currency: p.currency })}</span></li>)}
            </ul>
          )}
        </Async>
      </Card>
    </>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}
