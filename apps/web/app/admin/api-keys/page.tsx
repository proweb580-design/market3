'use client';

import { api } from '../../../lib/api';
import { ActionButton, Async, PageHead } from '../../dashboard/kit';
import { Pager, useCan, usePaged, when } from '../admin-kit';

interface Row {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  organizationId: string | null;
  userId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export default function ApiKeysPage() {
  const can = useCan();
  const list = usePaged<Row>('/admin/api-keys');
  return (
    <>
      <PageHead title="API keys" subtitle="All keys on the platform. Secrets are never stored or shown." />
      <Async state={list}>
        {(p) => (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {p.items.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span><b>{k.name}</b> <span className="text-muted-foreground">pk_{k.prefix}… · {k.organizationId ? 'store key' : 'personal key'} · {k.scopes.length} permissions · last used {when(k.lastUsedAt)}{k.revokedAt ? ' · revoked' : ''}</span></span>
                  {can('platform.api_keys.manage') && !k.revokedAt && <ActionButton variant="outline" confirm="Revoke this key? It stops working immediately." run={async () => { await api(`/admin/api-keys/${k.id}`, { method: 'DELETE' }); await list.reload(); }}>Revoke</ActionButton>}
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
