'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorLine, Loading, useLoad } from './kit';

interface Me {
  organizations: { slug: string }[];
}

/** One owner, one store: /dashboard goes straight to it. Creating stores is not offered here. */
export default function DashboardHome() {
  const router = useRouter();
  const me = useLoad<Me>('/auth/me');
  const store = me.data?.organizations[0];

  useEffect(() => {
    if (store) router.replace(`/dashboard/${store.slug}`);
  }, [store, router]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-sm">
      {me.error ? (
        <ErrorLine error={me.error} />
      ) : !me.data || store ? (
        <Loading />
      ) : (
        <>
          <p>У этого аккаунта нет доступа к магазину.</p>
          <p className="mt-2 text-xs text-muted-foreground">Войдите под аккаунтом владельца или попросите владельца прислать приглашение (раздел «Сотрудники»).</p>
          <Link href="/account" className="mt-4 inline-block text-xs underline">← В аккаунт</Link>
        </>
      )}
    </main>
  );
}
