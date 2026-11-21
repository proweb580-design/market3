'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PaymentBadges } from './primitives';
import { useStore } from './store-context';

const heading = 'label-xs font-bold';
const linkCls = 'text-sm text-muted-foreground transition-colors hover:text-foreground';

function LinkColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title} className="col-span-1 md:col-span-2">
      <h3 className={heading}>{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">{children}</ul>
    </nav>
  );
}

/** Site footer: brand, link columns and the legal bar, on one grid. Reviews live on the home page. */
export function Footer() {
  const { store, href } = useStore();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 overflow-clip border-t border-border">
      <div className="reveal grid grid-cols-2 gap-x-6 gap-y-10 px-page py-14 md:grid-cols-12">
        <div className="col-span-2 md:col-span-6">
          <p className="title-xl text-2xl">{store.name}</p>
          {store.hero?.subtitle && <p className="mt-3 max-w-xs text-sm text-muted-foreground">{store.hero.subtitle}</p>}
        </div>

        <LinkColumn title="Магазин">
          {store.footer.menu.map((l) => (
            <li key={l.label}>
              <Link href={href(l.path)} className={linkCls}>
                {l.label}
              </Link>
            </li>
          ))}
        </LinkColumn>

        <LinkColumn title="Помощь">
          {store.footer.help.map((l) => (
            <li key={l.label}>
              <Link href={href(l.path)} className={linkCls}>
                {l.label}
              </Link>
            </li>
          ))}
        </LinkColumn>

        {store.footer.socials.length > 0 && (
          <LinkColumn title="Мы в соцсетях">
            {store.footer.socials.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noreferrer" className={linkCls}>
                  {s.label}
                </a>
              </li>
            ))}
          </LinkColumn>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-page py-5">
        <p className="label-xs text-muted-foreground">
          © {year} {store.name}. Все права защищены.
        </p>
        <PaymentBadges badges={store.paymentBadges} />
      </div>

      <p
        aria-hidden
        className="title-xl -mb-[0.2em] select-none whitespace-nowrap text-center text-[23vw] leading-[0.8] tracking-tighter"
      >
        {store.name}
      </p>
    </footer>
  );
}
