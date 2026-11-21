'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../auth-provider';
import { Orders, Profile, Section, Sessions, TelegramLink, type Me } from './sections';

export default function AccountPage() {
  const router = useRouter();
  const { status, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false); // set while signing out on purpose, so the "signed out" redirect below doesn't fight the move to the home page

  const loadMe = useCallback(() => api<Me>('/auth/me').then(setMe).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load your account.')), []);

  useEffect(() => {
    if (status === 'signedOut' && !leaving.current) router.replace('/login?next=/account');
    if (status === 'signedIn') void loadMe();
  }, [status, router, loadMe]);

  const leave = async () => {
    leaving.current = true;
    await signOut();
    router.replace('/');
  };

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <Button className="mt-6" variant="outline" onClick={leave}>Sign out</Button>
      </main>
    );
  }
  if (!me) return <main className="mx-auto max-w-xl px-6 py-24"><p className="text-xs text-muted-foreground" aria-busy="true">Loading…</p></main>;

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Link href="/" className="label-xs text-muted-foreground hover:text-foreground">← Back to store</Link>
      <div className="mt-8 flex items-end justify-between gap-4">
        <div>
          <p className="label-xs text-muted-foreground">Account</p>
          <h1 className="title-xl text-4xl">{me.profile?.displayName || me.email || 'My account'}</h1>
          {me.email && <p className="mt-1 text-xs text-muted-foreground">{me.email}</p>}
        </div>
        <Button variant="outline" onClick={leave}>Sign out</Button>
      </div>

      {me.organizations.length > 0 && (
        <Section title="My stores">
          <ul className="flex flex-col gap-2 text-xs">
            {me.organizations.map((o) => (
              <li key={o.id} className="flex justify-between gap-4">
                <Link href={`/s/${o.slug}`} className="underline">{o.name}</Link>
                <span className="text-muted-foreground">{o.role.name}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Orders"><Orders /></Section>
      <Section title="Profile"><Profile me={me} onSaved={(profile) => setMe({ ...me, profile })} /></Section>
      <Section title="Telegram"><TelegramLink me={me} onChanged={loadMe} /></Section>
      <Section title="Devices"><Sessions /></Section>
      <Section title="Выйти из учётной записи"><Button variant="outline" onClick={leave}>Выйти</Button></Section>
    </main>
  );
}
