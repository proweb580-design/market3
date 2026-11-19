'use client';

import Link from 'next/link';
import { Async, Card, PageHead, useLoad } from '../kit';
import { useOrg } from '../org-context';

interface Subscription {
  plan: { name: string; code: string } | null;
  subscription: { status: string; currentPeriodEnd: string } | null;
  features: Record<string, { enabled: boolean; limit: number | null }>;
  usage: Record<string, number>;
}

const LABEL: Record<string, string> = { 'products.max': 'Products', 'members.max': 'Team members', 'storage.mb': 'Storage (MB)', 'api.requests_per_day': 'API requests / day' };

export default function Overview() {
  const org = useOrg();
  const base = `/dashboard/${org.slug}`;
  const sub = useLoad<Subscription>(`/organizations/${org.id}/subscription`);
  const pending = useLoad<{ total: number }>(`/organizations/${org.id}/orders?status=PENDING_PAYMENT&pageSize=1`);
  const paid = useLoad<{ total: number }>(`/organizations/${org.id}/orders?status=PAID&pageSize=1`);

  return (
    <>
      <PageHead title={org.name} subtitle={`Your role: ${org.role.name}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card title="Orders to fulfil">
          <p className="title-xl text-4xl">{paid.data?.total ?? '–'}</p>
          <Link href={`${base}/orders`} className="mt-2 inline-block text-xs underline">Open orders</Link>
        </Card>
        <Card title="Waiting for payment">
          <p className="title-xl text-4xl">{pending.data?.total ?? '–'}</p>
        </Card>
      </div>
      <Card title="Plan and usage">
        <Async state={sub}>
          {(s) => (
            <div className="flex flex-col gap-2 text-xs">
              <p><b>{s.plan?.name ?? 'No plan'}</b>{s.subscription ? ` · ${s.subscription.status.toLowerCase()} until ${new Date(s.subscription.currentPeriodEnd).toLocaleDateString()}` : ''}</p>
              <ul className="flex flex-col gap-1">
                {Object.entries(LABEL).map(([key, label]) => {
                  const limit = s.features[key]?.limit;
                  return <li key={key} className="flex justify-between"><span>{label}</span><span className="tabular-nums">{s.usage[key] ?? 0} / {limit === null || limit === undefined ? '∞' : limit}</span></li>;
                })}
              </ul>
              <Link href={`${base}/billing`} className="underline">Manage plan</Link>
            </div>
          )}
        </Async>
      </Card>
    </>
  );
}
