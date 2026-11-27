'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorLine, Loading, useLoad } from './kit';
import { SignOutButton } from './owner-login';

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
          <p className="mt-2 text-xs text-muted-foreground">Выйдите и войдите под логином владельца, или попросите владельца прислать приглашение (раздел «Сотрудники»).</p>
          <SignOutButton className="mt-4 text-xs underline" />
        </>
      )}
    </main>
  );
}
