'use client';

import { ArrowRight, Send } from 'lucide-react';
import { cn } from '../lib/utils';

/** Opens the bot's Main Mini App (set in @BotFather); without one Telegram just opens the bot chat with its menu button. */
export const miniAppUrl = (bot: string) => `https://t.me/${encodeURIComponent(bot)}?startapp`;

export function TelegramIcon({ className }: { className?: string }) {
  // The paper plane, nudged left so it sits optically centred in a circle.
  return <Send aria-hidden className={cn('-translate-x-px translate-y-px', className)} />;
}

/** Round Telegram button (footer). */
export function TelegramIconLink({ bot, className }: { bot: string; className?: string }) {
  return (
    <a
      href={miniAppUrl(bot)}
      target="_blank"
      rel="noreferrer"
      aria-label="Открыть магазин в Telegram"
      className={cn('inline-flex size-11 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-foreground hover:text-background', className)}
    >
      <TelegramIcon className="size-5" />
    </a>
  );
}

/** "We are in Telegram" card above the footer: the whole store as a Mini App. */
export function TelegramBanner({ bot, name }: { bot: string; name: string }) {
  return (
    <section className="reveal px-page pt-24">
      <div className="flex flex-col gap-5 rounded-lg border border-border bg-muted/40 p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8">
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <TelegramIcon className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="title-xl text-2xl">{name} в Telegram</h2>
          <p className="mt-1 text-sm text-muted-foreground">Каталог, корзина и заказы — в мини-приложении, прямо в Telegram. Следите за статусом заказа и пишите нам напрямую.</p>
        </div>
        <a
          href={miniAppUrl(bot)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition-opacity hover:opacity-85"
        >
          Открыть в Telegram <ArrowRight className="size-4" aria-hidden />
        </a>
      </div>
    </section>
  );
}
