'use client';

import { useState } from 'react';
import { Async, PageHead, TextField } from '../../dashboard/kit';
import { Pager, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorUserId: string | null;
  organizationId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const list = usePaged<Row>('/admin/audit-logs', { action: action.trim() }, 50);
  return (
    <>
      <PageHead title="Audit log" subtitle="Who did what. Secrets never appear here." />
      <div className="mb-4"><TextField label="Action starts with" value={action} onChange={setAction} placeholder="order. / payment. / user." /></div>
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((r) => (
                <li key={r.id} className="px-3 py-2 text-xs">
                  <p className="flex justify-between gap-3"><b>{r.action}</b><span className="text-muted-foreground">{when(r.createdAt)}</span></p>
                  <p className="break-all text-muted-foreground">{r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : ''}{r.actorUserId ? ` · by ${r.actorUserId}` : ' · system'}{r.ip ? ` · ${r.ip}` : ''}</p>
                  {r.metadata ? <p className="break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify(r.metadata)}</p> : null}
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
