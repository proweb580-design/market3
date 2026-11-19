'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, ErrorLine, PageHead, Select, TextField, errText, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Member {
  id: string;
  status: string;
  user: { id: string; email: string | null; profile: { displayName: string | null } | null };
  role: { id: string; key: string; name: string };
}
interface Role { id: string; key: string; name: string }
interface Invitation { id: string; email: string; expiresAt: string; role: { id: string; name: string } }

function Invite({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const org = useOrg();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(roles.find((r) => r.key === 'ORG_STAFF')?.id ?? roles[0]?.id ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const inv = await api<{ token: string }>(`/organizations/${org.id}/invitations`, { method: 'POST', body: { email: email.trim(), roleId } });
      // Emails are not sent yet: the link is shown once for the inviter to pass on.
      setLink(`${window.location.origin}/invite?token=${inv.token}`);
      setEmail('');
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-wrap items-end gap-3">
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
      <Select label="Role" value={roleId} onChange={setRoleId} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
      <Button type="submit" disabled={busy || !email}>{busy ? 'Inviting…' : 'Invite'}</Button>
      <div className="w-full"><ErrorLine error={error} /></div>
      {link && (
        <p role="status" className="w-full break-all text-xs">
          Send this link to the person (it is shown only once and works for 7 days): <b>{link}</b>
        </p>
      )}
    </form>
  );
}

export default function TeamPage() {
  const org = useOrg();
  const members = useLoad<Member[]>(`/organizations/${org.id}/members`);
  const roles = useLoad<Role[]>(`/organizations/${org.id}/roles`);
  const invites = useLoad<Invitation[]>(`/organizations/${org.id}/invitations`);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(memberId: string, roleId: string) {
    setError(null);
    try {
      await api(`/organizations/${org.id}/members/${memberId}`, { method: 'PATCH', body: { roleId } });
      await members.reload();
    } catch (e) {
      setError(errText(e));
      await members.reload();
    }
  }

  return (
    <>
      <PageHead title="Team" subtitle="People who can work in this store." />
      <Card title="Members">
        <ErrorLine error={error} />
        <Async state={members}>
          {(rows) => (
            <ul className="divide-y divide-border text-xs">
              {rows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span><b>{m.user.profile?.displayName ?? m.user.email}</b><span className="block text-muted-foreground">{m.user.email}{m.status !== 'ACTIVE' ? ` · ${m.status.toLowerCase()}` : ''}</span></span>
                  <span className="flex items-center gap-2">
                    <select aria-label={`Role of ${m.user.email}`} value={m.role.id} onChange={(e) => void changeRole(m.id, e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
                      {(roles.data ?? [m.role]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <ActionButton variant="outline" confirm={`Remove ${m.user.email ?? 'this member'} from the store?`} run={async () => { await api(`/organizations/${org.id}/members/${m.id}`, { method: 'DELETE' }); await members.reload(); }}>Remove</ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card title="Invite someone">
        <Async state={roles}>{(r) => <Invite roles={r} onDone={() => void invites.reload()} />}</Async>
      </Card>
      <Card title="Pending invitations">
        <Async state={invites}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-border text-xs">
                {rows.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                    <span><b>{i.email}</b> <span className="text-muted-foreground">as {i.role.name} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                    <ActionButton variant="outline" run={async () => { await api(`/organizations/${org.id}/invitations/${i.id}`, { method: 'DELETE' }); await invites.reload(); }}>Revoke</ActionButton>
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
