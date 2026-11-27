'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '../auth-provider';
import { OwnerLogin, SignOutButton } from './owner-login';

/** Everything under /dashboard needs a signed-in owner; the API enforces roles and tenant isolation on every call. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') return <p className="px-6 py-24 text-xs text-muted-foreground" aria-busy="true">Загрузка…</p>;
  if (status === 'signedOut') return <OwnerLogin />;
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 text-xs">
        <Link href="/dashboard" className="label-xs font-bold">Кабинет магазина</Link>
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
