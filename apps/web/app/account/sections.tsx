'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { formatMoney } from '@repo/ui/lib/format';
import { api, ApiError } from '../../lib/api';

export interface Me {
  id: string;
  email: string | null;
  profile: { displayName: string | null; phone: string | null; locale: string } | null;
  telegramAccount: { username: string | null; linkedAt: string } | null;
  organizations: { id: string; slug: string; name: string; role: { key: string; name: string } }[];
  isSuperAdmin: boolean;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-8">
      <h2 className="label-xs mb-4 font-bold">{title}</h2>
      {children}
    </section>
  );
}

// ───────────── orders ─────────────

interface OrderRow {
  id: string;
  number: number;
  status: string;
  currency: string;
  totalMinor: number;
  createdAt: string;
  itemCount: number;
  store: { slug: string; name: string };
}

const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Waiting for payment', PAID: 'Paid', FULFILLED: 'Shipped', CANCELED: 'Canceled', REFUNDED: 'Refunded' };

export function Orders() {
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Guest orders placed with this (verified) email join the account first.
    api('/users/me/orders/claim', { method: 'POST' })
      .catch(() => undefined)
      .then(() => api<{ items: OrderRow[] }>('/users/me/orders?pageSize=50'))
      .then((page) => live && setOrders(page.items))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>;
  if (!orders) return <p className="text-xs text-muted-foreground" aria-busy="true">Loading orders…</p>;
  if (orders.length === 0) return <p className="text-xs text-muted-foreground">No orders yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/s/${o.store.slug}/orders/${o.id}`} className="flex items-center justify-between gap-4 py-3 text-xs hover:opacity-70">
            <span>
              <span className="font-bold">{o.store.name} · #{o.number}</span>
              <span className="block text-muted-foreground">{new Date(o.createdAt).toLocaleDateString()} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · {STATUS_LABEL[o.status] ?? o.status}</span>
            </span>
            <span className="tabular-nums">{formatMoney({ amountMinor: o.totalMinor, currency: o.currency })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ───────────── profile ─────────────

export function Profile({ me, onSaved }: { me: Me; onSaved: (profile: NonNullable<Me['profile']>) => void }) {
  const [displayName, setDisplayName] = useState(me.profile?.displayName ?? '');
  const [phone, setPhone] = useState(me.profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api<NonNullable<Me['profile']>>('/profiles/me', { method: 'PATCH', body: { displayName: displayName.trim() || null, phone: phone.trim() || null } });
      onSaved(saved);
      setMessage({ ok: true, text: 'Профиль сохранён.' });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="name" className="label-xs">Name</Label>
        <Input id="name" value={displayName} maxLength={80} autoComplete="name" onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="phone" className="label-xs">Phone</Label>
        <Input id="phone" type="tel" value={phone} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
      </div>
      {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-xs' : 'text-xs text-destructive'}>{message.text}</p>}
      <Button type="submit" disabled={busy} className="self-start">{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

// ───────────── telegram ─────────────

// The store's Mini App bot; a deployment can override it with NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.
const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'Ashennew_bot';

export function TelegramLink({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { startParam } = await api<{ startParam: string }>('/telegram/link-code', { method: 'POST' });
      setLink(`https://t.me/${BOT}?startapp=${encodeURIComponent(startParam)}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await api('/users/me/telegram', { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (me.telegramAccount) {
    return (
      <div className="flex flex-col items-start gap-3 text-xs">
        <p>Linked{me.telegramAccount.username ? ` as @${me.telegramAccount.username}` : ''}. Your Telegram orders appear here.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button variant="outline" disabled={busy} onClick={unlink}>Unlink Telegram</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 text-xs">
      <p className="text-muted-foreground">Link Telegram to see the orders you place in the Mini App next to your web orders.</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {link ? (
        <>
          <Button asChild><a href={link} target="_blank" rel="noopener noreferrer">Open in Telegram</a></Button>
          <p className="text-muted-foreground">The link works once and expires in 10 minutes. Open it, then refresh this page.</p>
        </>
      ) : (
        <Button variant="outline" disabled={busy || !BOT} onClick={start}>{busy ? 'Please wait…' : 'Link Telegram'}</Button>
      )}
    </div>
  );
}

// ───────────── security ─────────────

interface SessionRow {
  id: string;
  kind: string;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export function Sessions() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<SessionRow[]>('/users/me/sessions').then(setRows).catch((e: unknown) => setError(errText(e)));
  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    try {
      await api(`/users/me/sessions/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(errText(e));
    }
  }

  if (error) return <p role="alert" className="text-xs text-destructive">{error}</p>;
  if (!rows) return <p className="text-xs text-muted-foreground" aria-busy="true">Loading devices…</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-xs">
          <span>
            <span className="font-bold">{s.kind === 'TELEGRAM' ? 'Telegram' : 'Web'}{s.current ? ' · this device' : ''}</span>
            <span className="block max-w-[28ch] truncate text-muted-foreground">{s.userAgent ?? 'Unknown device'} · {new Date(s.lastSeenAt).toLocaleString()}</span>
          </span>
          {!s.current && <Button variant="outline" size="sm" onClick={() => revoke(s.id)}>Sign out</Button>}
        </li>
      ))}
    </ul>
  );
}

export function DeleteAccount({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setError(null);
    try {
      await api('/users/me', { method: 'DELETE' });
      await onDeleted();
    } catch (e) {
      setError(errText(e));
    }
  }

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Delete my account…</Button>;
  return (
    <div className="flex max-w-sm flex-col gap-3 text-xs">
      <p>Your account is closed and you are signed out everywhere. Past orders are kept for the stores’ records. Type <b>DELETE</b> to confirm.</p>
      <Input aria-label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="destructive" disabled={confirm !== 'DELETE'} onClick={remove}>Delete account</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
