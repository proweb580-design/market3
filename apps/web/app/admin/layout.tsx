'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth } from '../auth-provider';
import { ErrorLine, Loading, useLoad } from '../dashboard/kit';
import { PermsContext } from './admin-kit';

interface Me {
  email: string | null;
  isSuperAdmin: boolean;
  platformRoles: string[];
  platformPermissions: string[];
}

const NAV = [
  ['', 'Overview', 'platform.stats.read'],
  ['/users', 'Users', 'platform.users.read'],
  ['/organizations', 'Stores', 'platform.organizations.read'],
  ['/plans', 'Plans', 'platform.plans.manage'],
  ['/subscriptions', 'Subscriptions', 'platform.subscriptions.read'],
  ['/payments', 'Payments', 'platform.payments.read'],
  ['/audit', 'Audit log', 'platform.audit.read'],
  ['/api-keys', 'API keys', 'platform.api_keys.read'],
  ['/settings', 'Settings', 'platform.settings.manage'],
] as const;

function Nav({ perms }: { perms: ReadonlySet<string> }) {
  const pathname = usePathname(); // needs its own Suspense boundary (it depends on the request URL)
  return (
    <nav aria-label="Admin sections" className="flex shrink-0 flex-row flex-wrap gap-x-4 gap-y-1 text-xs md:w-40 md:flex-col md:gap-1">
      {NAV.filter(([, , perm]) => perms.has(perm)).map(([path, label]) => {
        const href = `/admin${path}`;
        const active = path === '' ? pathname === '/admin' : pathname.startsWith(href);
        return <Link key={path} href={href} aria-current={active ? 'page' : undefined} className={active ? 'font-bold underline' : 'text-muted-foreground hover:text-foreground'}>{label}</Link>;
      })}
    </nav>
  );
}

/** Platform administration. The server checks every permission on every call; this layout only hides what you can't open. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const me = useLoad<Me>(status === 'signedIn' ? '/auth/me' : null);
  const perms = useMemo(() => new Set(me.data?.platformPermissions ?? []), [me.data]);

  useEffect(() => {
    if (status === 'signedOut') router.replace(`/login?next=${encodeURIComponent('/admin')}`);
  }, [status, router]);

  if (status !== 'signedIn' || (!me.data && !me.error)) return <div className="px-6 py-24"><Loading /></div>;
  if (me.error) return <main className="px-6 py-10"><ErrorLine error={me.error} /></main>;
  if (perms.size === 0 && !me.data?.isSuperAdmin) {
    return (
      <main className="px-6 py-24 text-sm">
        <p>This area is for platform administrators.</p>
        <Link href="/" className="mt-4 inline-block underline">← Back</Link>
      </main>
    );
  }

  return (
    <PermsContext value={perms}>
      <div className="min-h-screen">
        <header className="flex items-center justify-between border-b border-border px-6 py-3 text-xs">
          <span className="label-xs font-bold">Platform admin</span>
          <span className="text-muted-foreground">{me.data?.email} · {me.data?.platformRoles.join(', ')}</span>
        </header>
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 md:flex-row">
          <Suspense fallback={null}>
            <Nav perms={perms} />
          </Suspense>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </PermsContext>
  );
}
