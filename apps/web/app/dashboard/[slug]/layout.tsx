'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorLine, Loading, useLoad } from '../kit';
import { LibraryProvider } from '../media-lib';
import { OrgProvider, type Org } from '../org-context';

interface Me {
  organizations: { id: string; slug: string; name: string; role: { key: string; name: string } }[];
}

/** What an owner opens every day first; the rarely used sections sit under "Ещё". */
const NAV = [
  ['', 'Главная'],
  ['/orders', 'Заказы'],
  ['/products', 'Товары'],
  ['/collections', 'Коллекции'],
  ['/storefront', 'Витрина'],
  ['/support', 'Обращения'],
  ['/settings', 'Настройки'],
] as const;
const MORE = [
  ['/size-charts', 'Таблицы размеров'],
  ['/team', 'Сотрудники'],
  ['/billing', 'Тариф'],
] as const;

/** Loads the store's own details (currency) before showing any page that prints prices. */
function WithDetails({ org, children }: { org: Omit<Org, 'currency'>; children: (org: Org) => ReactNode }) {
  const details = useLoad<{ currency: string }>(`/organizations/${org.id}`);
  if (details.error) return <ErrorLine error={details.error} />;
  if (!details.data) return <Loading />;
  return <>{children({ ...org, currency: details.data.currency })}</>;
}

function NavLink({ href, pathname, exact, children }: { href: string; pathname: string; exact?: boolean; children: ReactNode }) {
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={active ? 'font-bold underline' : 'text-muted-foreground hover:text-foreground'}>
      {children}
    </Link>
  );
}

/** Resolves the store from the URL among the user's own memberships; anything else is "not found" (the API agrees). */
export default function OrgLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const me = useLoad<Me>('/auth/me');
  const org = me.data?.organizations.find((o) => o.slug === slug);

  if (me.error) return <main className="px-6 py-10"><ErrorLine error={me.error} /></main>;
  if (!me.data) return <main className="px-6 py-10"><Loading /></main>;
  if (!org) {
    return (
      <main className="px-6 py-10 text-sm">
        <p>Магазин не найден, или у вас нет к нему доступа.</p>
        <Link href="/dashboard" className="mt-4 inline-block underline">← Мои магазины</Link>
      </main>
    );
  }

  const base = `/dashboard/${org.slug}`;
  return (
    <WithDetails org={org}>
      {(full) => (
    <OrgProvider value={full}>
      <LibraryProvider orgId={full.id}>
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 md:flex-row">
        <nav aria-label="Разделы магазина" className="flex shrink-0 flex-row flex-wrap gap-x-4 gap-y-1 text-xs md:w-44 md:flex-col md:gap-1">
          <p className="label-xs mb-2 w-full font-bold">{org.name}</p>
          {NAV.map(([path, label]) => <NavLink key={path} href={`${base}${path}`} exact={path === ''} pathname={pathname}>{label}</NavLink>)}
          <p className="label-xs mt-4 mb-1 w-full text-muted-foreground">Ещё</p>
          {MORE.map(([path, label]) => <NavLink key={path} href={`${base}${path}`} pathname={pathname}>{label}</NavLink>)}
          <Link href={`/s/${org.slug}`} target="_blank" className="mt-4 w-full font-bold hover:underline">Открыть магазин ↗</Link>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      </LibraryProvider>
    </OrgProvider>
      )}
    </WithDetails>
  );
}
