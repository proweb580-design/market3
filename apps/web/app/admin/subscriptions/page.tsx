'use client';

import { useState } from 'react';
import { api } from '../../../lib/api';
import { ActionButton, Async, PageHead, Select } from '../../dashboard/kit';
import { Pager, useCan, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  plan: { code: string; name: string };
  organization: { slug: string; name: string };
}

export default function SubscriptionsPage() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const list = usePaged<Row>('/admin/subscriptions', { status });
  return (
    <>
      <PageHead title="Subscriptions" actions={can('platform.subscriptions.manage') ? <ActionButton variant="outline" run={async () => { await api('/admin/subscriptions/run-lifecycle', { method: 'POST' }); await list.reload(); }}>Run expiry job now</ActionButton> : undefined} />
      <div className="mb-4"><Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'].map((s) => ({ value: s, label: s.toLowerCase() }))]} /></div>
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span><b>{s.organization.name}</b> <span className="text-muted-foreground">{s.plan.name} · {s.status.toLowerCase()} · until {when(s.currentPeriodEnd)}{s.cancelAtPeriodEnd ? ' · ends at period end' : ''}</span></span>
                  {can('platform.subscriptions.manage') && ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(s.status) && (
                    <ActionButton variant="outline" confirm={`End ${s.organization.name}'s ${s.plan.name} plan now? It falls back to Free.`} run={async () => { await api(`/admin/subscriptions/${s.id}/terminate`, { method: 'POST' }); await list.reload(); }}>End now</ActionButton>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={p.page} pageSize={p.pageSize} total={p.total} onPage={list.setPage} />
          </>
        )}
      </Async>
    </>
  );
}
