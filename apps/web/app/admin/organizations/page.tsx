'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../lib/api';
import { ActionButton, Async, Card, PageHead, Select, TextField, useLoad } from '../../dashboard/kit';
import { Pager, useCan, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  _count: { members: number };
}
interface Plan { code: string; name: string }

function Grant({ org, onClose }: { org: Row; onClose: () => void }) {
  const plans = useLoad<Plan[]>('/admin/plans');
  const [code, setCode] = useState('');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  return (
    <Card title={`Give a plan to ${org.name}`}>
      <Async state={plans}>
        {(list) => (
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Plan" value={code || list[0]?.code || ''} onChange={setCode} options={list.map((p) => ({ value: p.code, label: p.name }))} />
            <TextField label="Days" type="number" value={days} onChange={setDays} />
            <TextField label="Reason" value={reason} onChange={setReason} maxLength={240} />
            <ActionButton run={async () => { await api(`/admin/organizations/${org.id}/subscription`, { method: 'POST', body: { planCode: code || list[0]?.code, days: Number(days), ...(reason.trim() ? { reason: reason.trim() } : {}) } }); onClose(); }}>Give plan</ActionButton>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        )}
      </Async>
    </Card>
  );
}

export default function OrganizationsPage() {
  const can = useCan();
  const list = usePaged<Row>('/admin/organizations');
  const [granting, setGranting] = useState<Row | null>(null);
  return (
    <>
      <PageHead title="Stores" />
      {granting && <Grant org={granting} onClose={() => setGranting(null)} />}
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span><Link href={`/s/${o.slug}`} className="font-bold underline">{o.name}</Link> <span className="text-muted-foreground">/{o.slug} · {o._count.members} members · created {when(o.createdAt)} · {o.status.toLowerCase()}</span></span>
                  <span className="flex gap-2">
                    {can('platform.subscriptions.manage') && <Button variant="outline" size="sm" onClick={() => setGranting(o)}>Give plan</Button>}
                    {can('platform.organizations.manage') && (o.status === 'ACTIVE'
                      ? <ActionButton variant="destructive" confirm={`Suspend ${o.name}? Its store goes offline immediately.`} run={async () => { await api(`/admin/organizations/${o.id}/suspend`, { method: 'POST' }); await list.reload(); }}>Suspend</ActionButton>
                      : <ActionButton run={async () => { await api(`/admin/organizations/${o.id}/activate`, { method: 'POST' }); await list.reload(); }}>Activate</ActionButton>)}
                  </span>
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
