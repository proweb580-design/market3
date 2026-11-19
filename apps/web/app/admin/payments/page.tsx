'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../lib/api';
import { ActionButton, Async, Card, PageHead, Select, TextField, toMinor } from '../../dashboard/kit';
import { Pager, money, useCan, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  purpose: 'SUBSCRIPTION' | 'ORDER';
  status: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  organizationId: string;
  failureReason: string | null;
  transactions: { id: string; type: string; amountMinor: number; status: string }[];
}

const REFUNDABLE = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];

function Refund({ payment, onDone }: { payment: Row; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Card title={`Refund ${money(payment.amountMinor, payment.currency)} payment`}>
      <div className="flex flex-wrap items-end gap-3">
        <TextField label="Amount (empty = everything left)" value={amount} onChange={setAmount} />
        <TextField label="Reason" value={reason} onChange={setReason} maxLength={240} />
        <ActionButton
          confirm="Refund this payment? The money goes back to the customer's card."
          run={async () => {
            const minor = amount.trim() ? toMinor(amount) : undefined;
            if (amount.trim() && minor === null) throw new Error('Enter the amount like 12.50');
            await api(`/admin/payments/${payment.id}/refund`, { method: 'POST', body: { ...(minor ? { amountMinor: minor } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) } });
            onDone();
          }}
        >
          Refund
        </ActionButton>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </Card>
  );
}

export default function PaymentsPage() {
  const can = useCan();
  const [status, setStatus] = useState('');
  const list = usePaged<Row>('/admin/payments', { status });
  const [refunding, setRefunding] = useState<Row | null>(null);
  return (
    <>
      <PageHead title="Payments" subtitle="Subscription payments and shoppers' order payments." />
      <div className="mb-4"><Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, ...['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED'].map((s) => ({ value: s, label: s.toLowerCase().replace('_', ' ') }))]} /></div>
      {refunding && <Refund payment={refunding} onDone={() => { setRefunding(null); void list.reload(); }} />}
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span><b className="tabular-nums">{money(x.amountMinor, x.currency)}</b> <span className="text-muted-foreground">{x.purpose === 'ORDER' ? 'order' : 'plan'} · {x.status.toLowerCase().replace('_', ' ')} · {when(x.createdAt)}{x.failureReason ? ` · ${x.failureReason}` : ''}</span></span>
                  {can('platform.payments.refund') && REFUNDABLE.includes(x.status) && <Button variant="outline" size="sm" onClick={() => setRefunding(x)}>Refund…</Button>}
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
