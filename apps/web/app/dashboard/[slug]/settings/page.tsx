'use client';

import { useState } from 'react';
import { PERMISSIONS } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, Check, ErrorLine, PageHead, TextField, errText, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

function General() {
  const org = useOrg();
  const [name, setName] = useState(org.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/organizations/${org.id}`, { method: 'PATCH', body: { name: name.trim() } });
      setMessage({ ok: true, text: 'Saved. Reload the page to see the new name everywhere.' });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Store">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-sm flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} maxLength={80} />
        <p className="text-[11px] text-muted-foreground">Address: <b>/s/{org.slug}</b> · Currency: <b>{org.currency}</b> (they can’t be changed once orders exist).</p>
        {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-xs' : 'text-xs text-destructive'}>{message.text}</p>}
        <Button type="submit" disabled={busy || name.trim().length < 2} className="self-start">{busy ? 'Saving…' : 'Save'}</Button>
      </form>
    </Card>
  );
}

function TelegramBot() {
  const org = useOrg();
  const status = useLoad<{ connected: boolean; bot: { username?: string } | null; usingPlatformBot: boolean }>(`/organizations/${org.id}/integrations/telegram`);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api(`/organizations/${org.id}/integrations/telegram`, { method: 'PUT', body: { botToken: token.trim() } });
      setToken('');
      await status.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Telegram bot">
      <Async state={status}>
        {(s) => (
          <div className="flex flex-col items-start gap-3 text-xs">
            {s.connected ? (
              <>
                <p>Connected{s.bot?.username ? ` as @${s.bot.username}` : ''}. Your store opens from this bot as a Mini App.</p>
                <ActionButton variant="outline" confirm="Disconnect your bot? The store will use the platform bot." run={async () => { await api(`/organizations/${org.id}/integrations/telegram`, { method: 'DELETE' }); await status.reload(); }}>Disconnect</ActionButton>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">{s.usingPlatformBot ? 'Your store currently opens from the platform bot.' : 'No bot connected.'} To use your own bot, create it in @BotFather and paste its token. The token is stored encrypted and never shown again (needs a plan with the Mini App).</p>
                <form onSubmit={(e) => { e.preventDefault(); void connect(); }} className="flex w-full max-w-md items-end gap-2">
                  <div className="flex-1"><TextField label="Bot token" value={token} onChange={setToken} type="password" /></div>
                  <Button type="submit" disabled={busy || !token}>{busy ? 'Connecting…' : 'Connect'}</Button>
                </form>
                <ErrorLine error={error} />
              </>
            )}
          </div>
        )}
      </Async>
    </Card>
  );
}

interface Key { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null }

const ORG_SCOPES = Object.entries(PERMISSIONS).filter(([, p]) => p.scope === 'ORGANIZATION').map(([key, p]) => ({ key, description: p.description }));
const READ_ONLY = ['catalog.read', 'orders.read'];

function ApiKeys() {
  const org = useOrg();
  const keys = useLoad<Key[]>(`/organizations/${org.id}/api-keys`);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(READ_ONLY);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setSecret(null);
    try {
      const k = await api<{ secret: string }>(`/organizations/${org.id}/api-keys`, { method: 'POST', body: { name: name.trim(), scopes } });
      setSecret(k.secret);
      setName('');
      await keys.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="API keys">
      <p className="mb-3 text-[11px] text-muted-foreground">For integrations (needs a plan with API access). A key can only do what you tick here, and only inside this store.</p>
      <Async state={keys}>
        {(rows) => (
          <ul className="mb-4 divide-y divide-border text-xs">
            {rows.filter((k) => !k.revokedAt).map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                <span><b>{k.name}</b> <span className="text-muted-foreground">pk_{k.prefix}… · {k.scopes.length} permissions · {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}</span></span>
                <ActionButton variant="outline" confirm="Revoke this key? Integrations using it stop working immediately." run={async () => { await api(`/organizations/${org.id}/api-keys/${k.id}`, { method: 'DELETE' }); await keys.reload(); }}>Revoke</ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Async>
      <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex flex-col gap-3">
        <div className="max-w-sm"><TextField label="New key name" value={name} onChange={setName} maxLength={60} /></div>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="label-xs mb-1">Permissions</legend>
          {ORG_SCOPES.map((s) => <Check key={s.key} label={`${s.key} — ${s.description}`} checked={scopes.includes(s.key)} onChange={(on) => setScopes(on ? [...scopes, s.key] : scopes.filter((x) => x !== s.key))} />)}
        </fieldset>
        <ErrorLine error={error} />
        {secret && <p role="status" className="break-all text-xs">Copy the key now — it is shown only once: <b>{secret}</b></p>}
        <Button type="submit" disabled={busy || name.trim().length < 2 || scopes.length === 0} className="self-start">{busy ? 'Creating…' : 'Create key'}</Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHead title="Settings" />
      <General />
      <TelegramBot />
      <ApiKeys />
    </>
  );
}
