'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, PageHead, Select, TextField } from '../../dashboard/kit';
import { Pager, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  profile: { displayName: string | null } | null;
  platformRoles: string[];
}

export default function UsersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = usePaged<Row>('/admin/users', { q, status });
  return (
    <>
      <PageHead title="Users" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField label="Search" value={q} onChange={setQ} placeholder="Email or name" />
        <Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'BLOCKED', label: 'Blocked' }, { value: 'DELETED', label: 'Deleted' }]} />
      </div>
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-muted">
                    <span><b>{u.profile?.displayName ?? u.email ?? 'Telegram user'}</b> <span className="text-muted-foreground">{u.email}{u.platformRoles.length ? ` · ${u.platformRoles.join(', ')}` : ''}</span></span>
                    <span className="text-muted-foreground">{u.status.toLowerCase()} · seen {when(u.lastSeenAt)}</span>
                  </Link>
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
