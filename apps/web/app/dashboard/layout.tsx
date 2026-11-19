'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../auth-provider';

/** Everything under /dashboard needs a signed-in user; the API enforces roles and tenant isolation on every call. */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signedOut') router.replace(`/login?next=${encodeURIComponent('/dashboard')}`);
  }, [status, router]);

  if (status !== 'signedIn') return <p className="px-6 py-24 text-xs text-muted-foreground" aria-busy="true">Loading…</p>;
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 text-xs">
        <Link href="/dashboard" className="label-xs font-bold">Brand dashboard</Link>
        <Link href="/account" className="text-muted-foreground hover:text-foreground">My account</Link>
      </header>
      {children}
    </div>
  );
}
