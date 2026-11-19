'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PLAN_FEATURES } from '@repo/shared';
import { formatMoney } from '@repo/ui/lib/format';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, ErrorLine, PageHead, errText, useLoad } from '../../kit';
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
        setText(p.status === 'SUCCEEDED' ? 'Payment received — your plan is active.' : p.status === 'PENDING' ? 'We are still waiting for the payment to be confirmed.' : `Payment ${p.status.toLowerCase()}.`);
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
      <PageHead title="Billing" />
      <ReturnNotice onDone={reload} />
      <Card title="Current plan">
        <Async state={current}>
          {(c) => (
            <div className="flex flex-col items-start gap-2 text-xs">
              <p><b>{c.plan?.name ?? 'No plan'}</b>{c.subscription ? ` · ${c.subscription.status.toLowerCase()}` : ''}</p>
              {c.subscription && c.plan?.code !== 'FREE' && (
                <p className="text-muted-foreground">{c.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews or ends'} on {new Date(c.subscription.currentPeriodEnd).toLocaleDateString()}{c.subscription.trialEndsAt ? ` · trial until ${new Date(c.subscription.trialEndsAt).toLocaleDateString()}` : ''}. Plans are paid per period and are not renewed automatically.</p>
              )}
              {c.subscription && c.plan?.code !== 'FREE' && (c.subscription.cancelAtPeriodEnd
                ? <ActionButton variant="outline" run={async () => { await api(`/organizations/${org.id}/subscription/resume`, { method: 'POST' }); await current.reload(); }}>Keep the plan</ActionButton>
                : <ActionButton variant="outline" confirm="Switch to the Free plan when the current period ends?" run={async () => { await api(`/organizations/${org.id}/subscription/cancel`, { method: 'POST' }); await current.reload(); }}>Cancel at period end</ActionButton>)}
            </div>
          )}
        </Async>
      </Card>

      <Card title="Plans">
        <Async state={plans}>
          {(list) => (
            <ul className="grid gap-4 md:grid-cols-2">
              {list.map((p) => {
                const here = current.data?.plan?.code === p.code;
                return (
                  <li key={p.id} className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
                    <p className="flex justify-between"><b>{p.name}</b><span className="tabular-nums">{p.priceMinor === 0 ? 'Free' : `${formatMoney({ amountMinor: p.priceMinor, currency: p.currency })} / ${p.interval === 'YEAR' ? 'year' : 'month'}`}</span></p>
                    {p.description && <p className="text-muted-foreground">{p.description}</p>}
                    <ul className="text-muted-foreground">
                      {Object.entries(p.features).filter(([, f]) => f.enabled).map(([key, f]) => (
                        <li key={key}>✓ {PLAN_FEATURES[key as keyof typeof PLAN_FEATURES]?.description ?? key}{f.limit !== null && f.limit !== undefined ? `: ${f.limit}` : ''}</li>
                      ))}
                    </ul>
                    {p.priceMinor > 0 && (
                      <span className="mt-auto flex gap-2">
                        {p.trialDays > 0 && !here && <ActionButton variant="outline" run={async () => { await api(`/organizations/${org.id}/subscription/trial`, { method: 'POST', body: { planCode: p.code } }); await current.reload(); }}>Try {p.trialDays} days free</ActionButton>}
                        <ActionButton run={buy(p.code)}>{here ? 'Renew' : 'Choose'}</ActionButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
        <p className="mt-3 text-[11px] text-muted-foreground">Payments run in the provider’s test mode until live payments are enabled for the platform.</p>
      </Card>

      <Card title="Recent payments">
        <Async state={payments}>
          {({ items }) => items.length === 0 ? <p className="text-xs text-muted-foreground">No payments yet.</p> : (
            <ul className="divide-y divide-border text-xs">
              {items.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{new Date(p.createdAt).toLocaleString()} · {p.status.toLowerCase()}</span><span className="tabular-nums">{formatMoney({ amountMinor: p.amountMinor, currency: p.currency })}</span></li>)}
            </ul>
          )}
        </Async>
      </Card>
      <ErrorLine error={null} />
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
