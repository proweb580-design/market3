'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { Skeleton } from '@repo/ui/components/ui/skeleton';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../auth-provider';
import { Orders, OrdersSkeleton, Section, type Me } from './sections';

export default function AccountPage() {
  const router = useRouter();
  const { status, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false); // set while signing out on purpose, so the "signed out" redirect below doesn't fight the move to the home page

  const loadMe = useCallback(() => api<Me>('/auth/me').then(setMe).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить аккаунт.')), []);

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
        <Button className="mt-6" variant="outline" onClick={leave}>Выйти</Button>
      </main>
    );
  }
  // The page frame renders at once; orders start loading in parallel with /auth/me instead of after it.
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <Link href="/" className="label-xs text-muted-foreground hover:text-foreground">← Вернуться в магазин</Link>
      <div className="mt-8 flex items-end justify-between gap-4">
        {me ? (
          <div>
            <p className="label-xs text-muted-foreground">Аккаунт</p>
            <h1 className="title-xl text-4xl">{me.profile?.displayName || me.email || 'Мой аккаунт'}</h1>
            {me.email && <p className="mt-1 text-xs text-muted-foreground">{me.email}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Загрузка аккаунта">
            <p className="label-xs text-muted-foreground">Аккаунт</p>
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-3 w-40" />
          </div>
        )}
        <Button variant="outline" onClick={leave} disabled={status !== 'signedIn'}>Выйти</Button>
      </div>

      {me && me.organizations.length > 0 && (
        <Section title="Мои магазины">
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

      <Section title="История заказов">{status === 'signedIn' ? <Orders /> : <OrdersSkeleton />}</Section>
    </main>
  );
}
