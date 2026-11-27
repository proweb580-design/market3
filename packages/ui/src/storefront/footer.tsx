'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useStore } from './store-context';
import { TelegramBanner, TelegramIconLink } from './telegram-cta';

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
// Every store has the support form, so its link is always shown (last in «Помощь»).
const SUPPORT = { label: 'Поддержка', path: '/pages/support' };

export function Footer() {
  const { store, href, variant } = useStore();
  // Inside the Mini App the store already is in Telegram: no banner, no icon.
  const bot = variant === 'web' ? store.telegramBot : null;
  const year = new Date().getFullYear();

  return (
    <>
    {bot && <TelegramBanner bot={bot} name={store.name} />}
    <footer className={`${bot ? 'mt-14' : 'mt-24'} overflow-clip border-t border-border`}>
      <div className="reveal grid grid-cols-2 gap-x-6 gap-y-10 px-page py-14 md:grid-cols-12">
        <div className="col-span-2 md:col-span-6">
          <p className="title-xl text-2xl">{store.name}</p>
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
          {[...store.footer.help.filter((l) => l.path !== SUPPORT.path), SUPPORT].map((l) => (
            <li key={l.label}>
              <Link href={href(l.path)} className={linkCls}>
                {l.label}
              </Link>
            </li>
          ))}
        </LinkColumn>

        {bot && (
          <nav aria-label="Мы в Telegram" className="col-span-1 md:col-span-2">
            <h3 className={heading}>Мы в Telegram</h3>
            <TelegramIconLink bot={bot} className="mt-4" />
          </nav>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-page py-5">
        <p className="label-xs text-muted-foreground">
          © {year} {store.name}. Все права защищены.
        </p>
      </div>

      <p
        aria-hidden
        className="title-xl -mb-[0.2em] select-none whitespace-nowrap text-center text-[23vw] leading-[0.8] tracking-tighter"
      >
        {store.name}
      </p>
    </footer>
    </>
  );
}
