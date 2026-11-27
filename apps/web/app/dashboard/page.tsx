'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../lib/api';
import { Async, Card, ErrorLine, PageHead, TextField, errText, roleName, slugify, useLoad } from './kit';

interface Me {
  organizations: { id: string; slug: string; name: string; status: string; role: { key: string; name: string } }[];
}

function CreateStore() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const org = await api<{ slug: string }>('/organizations', { method: 'POST', body: { name: name.trim(), slug } });
      router.push(`/dashboard/${org.slug}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Card title="Создать магазин">
      <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex max-w-sm flex-col gap-3">
        <TextField label="Название магазина" value={name} onChange={(v) => { setName(v); if (!touched) setSlug(slugify(v)); }} maxLength={80} />
        <TextField label="Адрес" value={slug} onChange={(v) => { setTouched(true); setSlug(v.toLowerCase()); }} hint={`Магазин будет по адресу /s/${slug || 'moy-magazin'}`} />
        <ErrorLine error={error} />
        <Button type="submit" disabled={busy || name.trim().length < 2 || slug.length < 2} className="self-start">{busy ? 'Создаём…' : 'Создать магазин'}</Button>
      </form>
    </Card>
  );
}

export default function DashboardHome() {
  const me = useLoad<Me>('/auth/me');
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHead title="Мои магазины" />
      <Async state={me}>
        {(m) => (
          <>
            {m.organizations.length === 0 ? (
              <p className="mb-6 text-xs text-muted-foreground">У вас пока нет магазина. Создайте первый — он начнёт работу на бесплатном тарифе.</p>
            ) : (
              <ul className="mb-6 divide-y divide-border rounded-md border border-border">
                {m.organizations.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dashboard/${o.slug}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted">
                      <span className="font-bold">{o.name}</span>
                      <span className="text-xs text-muted-foreground">{roleName(o.role)}{o.status !== 'ACTIVE' ? ' · приостановлен' : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <CreateStore />
          </>
        )}
      </Async>
    </main>
  );
}
