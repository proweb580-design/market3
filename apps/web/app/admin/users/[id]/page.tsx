'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, PageHead, Select, TextField, useLoad } from '../../../dashboard/kit';
import { useCan, when } from '../../admin-kit';

interface User {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  profile: { displayName: string | null; phone: string | null } | null;
  telegramAccount: { username: string | null; linkedAt: string } | null;
  roles: { role: { id: string; key: string; name: string } }[];
  memberships: { organization: { id: string; slug: string; name: string }; role: { key: string } }[];
  _count: { sessions: number };
}
interface Role { id: string; key: string; name: string; scope: string }

function Roles({ user, onChanged }: { user: User; onChanged: () => void }) {
  const can = useCan();
  const roles = useLoad<Role[]>(can('platform.roles.manage') ? '/roles' : null);
  const [roleId, setRoleId] = useState('');
  const assigned = new Set(user.roles.map((r) => r.role.id));
  const options = (roles.data ?? []).filter((r) => r.scope === 'PLATFORM' && !assigned.has(r.id));
  return (
    <Card title="Platform roles">
      <ul className="mb-3 flex flex-col gap-1 text-xs">
        {user.roles.length === 0 && <li className="text-muted-foreground">No platform roles.</li>}
        {user.roles.map(({ role }) => (
          <li key={role.id} className="flex items-center justify-between">
            <span>{role.name} <span className="text-muted-foreground">({role.key})</span></span>
            {can('platform.roles.manage') && <ActionButton variant="outline" confirm={`Remove the ${role.name} role?`} run={async () => { await api(`/users/${user.id}/roles/${role.id}`, { method: 'DELETE' }); onChanged(); }}>Remove</ActionButton>}
          </li>
        ))}
      </ul>
      {can('platform.roles.manage') && options.length > 0 && (
        <div className="flex items-end gap-2">
          <Select label="Add role" value={roleId || options[0]!.id} onChange={setRoleId} options={options.map((r) => ({ value: r.id, label: r.name }))} />
          <ActionButton run={async () => { await api(`/users/${user.id}/roles`, { method: 'POST', body: { roleId: roleId || options[0]!.id } }); setRoleId(''); onChanged(); }}>Assign</ActionButton>
        </div>
      )}
    </Card>
  );
}

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const user = useLoad<User>(`/admin/users/${id}`);
  const [reason, setReason] = useState('');

  return (
    <Async state={user}>
      {(u) => (
        <>
          <PageHead title={u.profile?.displayName ?? u.email ?? 'Telegram user'} subtitle={`${u.status.toLowerCase()} · joined ${when(u.createdAt)} · ${u._count.sessions} active sessions`} />
          <Card title="Account">
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">Email: </dt><dd className="inline">{u.email ?? '—'}</dd></div>
              <div><dt className="inline text-muted-foreground">Phone: </dt><dd className="inline">{u.profile?.phone ?? '—'}</dd></div>
              <div><dt className="inline text-muted-foreground">Telegram: </dt><dd className="inline">{u.telegramAccount ? `@${u.telegramAccount.username ?? 'unknown'}` : '—'}</dd></div>
              <div><dt className="inline text-muted-foreground">Last seen: </dt><dd className="inline">{when(u.lastSeenAt)}</dd></div>
            </dl>
            {can('platform.users.manage') && u.status !== 'DELETED' && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {u.status === 'ACTIVE' ? (
                  <>
                    <TextField label="Reason (optional)" value={reason} onChange={setReason} maxLength={240} />
                    <ActionButton variant="destructive" confirm="Block this user? They are signed out everywhere immediately." run={async () => { await api(`/admin/users/${u.id}/block`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} }); await user.reload(); }}>Block</ActionButton>
                  </>
                ) : (
                  <ActionButton run={async () => { await api(`/admin/users/${u.id}/unblock`, { method: 'POST' }); await user.reload(); }}>Unblock</ActionButton>
                )}
              </div>
            )}
          </Card>
          <Roles user={u} onChanged={() => void user.reload()} />
          <Card title="Stores">
            {u.memberships.length === 0 ? <p className="text-xs text-muted-foreground">Not a member of any store.</p> : (
              <ul className="text-xs">{u.memberships.map((m) => <li key={m.organization.id}><Link href={`/s/${m.organization.slug}`} className="underline">{m.organization.name}</Link> <span className="text-muted-foreground">· {m.role.key}</span></li>)}</ul>
            )}
          </Card>
          <Link href="/admin/users" className="text-xs underline">← All users</Link>
        </>
      )}
    </Async>
  );
}
