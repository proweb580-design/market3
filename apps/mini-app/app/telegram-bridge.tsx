'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { usePrimaryAction, useStore } from '@repo/ui/storefront/store-context';
import { telegramSession, telegramWebApp, type TelegramWebApp } from './telegram';

/** Telegram theme → our design tokens, so the store follows the user's Telegram colours. */
function applyTheme(app: TelegramWebApp) {
  const t = app.themeParams;
  const root = document.documentElement;
  const map: [keyof typeof t, string[]][] = [
    ['bg_color', ['--background', '--card', '--popover']],
    ['text_color', ['--foreground', '--card-foreground', '--popover-foreground']],
    ['hint_color', ['--muted-foreground']],
    ['button_color', ['--primary', '--ring']],
    ['button_text_color', ['--primary-foreground']],
    ['secondary_bg_color', ['--secondary', '--muted', '--accent']],
  ];
  for (const [param, vars] of map) {
    const value = t[param];
    if (value && /^#[0-9a-f]{3,8}$/i.test(value)) for (const v of vars) root.style.setProperty(v, value);
  }
  root.classList.toggle('dark', app.colorScheme === 'dark');
}

/**
 * Connects the storefront to Telegram when running inside it (no-op in a normal browser):
 * ready/expand, theme, BackButton, MainButton for the page's primary action, and sign-in.
 */
export function TelegramBridge() {
  const { store, href, setNativePrimary, setHost } = useStore();
  const primaryAction = usePrimaryAction();
  const pathname = usePathname();
  const router = useRouter();

  // Launch: tell Telegram we're ready, take the full height, adopt its theme, sign in.
  useEffect(() => {
    const app = telegramWebApp();
    if (!app) return;
    app.ready();
    app.expand();
    applyTheme(app);
    const onTheme = () => applyTheme(app);
    app.onEvent('themeChanged', onTheme);
    setNativePrimary(true);
    // The session is kept for upcoming cart/checkout calls; browsing works even if sign-in fails (e.g. plan without Mini App).
    const token = () => telegramSession(store.slug, app.initData).then((s) => s?.accessToken ?? null, () => null);
    void token();
    // Orders made in the Mini App belong to the Telegram user; the payment page opens in the system browser.
    setHost({ getAuthToken: token, openLink: (url) => app.openLink(url) });
    return () => {
      setHost(null);
      app.offEvent('themeChanged', onTheme);
      setNativePrimary(false);
    };
  }, [store.slug, setNativePrimary, setHost]);

  // Telegram's own Back button replaces in-page navigation chrome; hidden on the store's home page.
  useEffect(() => {
    const app = telegramWebApp();
    if (!app) return;
    const onBack = () => router.back();
    if (pathname === href()) app.BackButton.hide();
    else app.BackButton.show();
    app.BackButton.onClick(onBack);
    return () => app.BackButton.offClick(onBack);
  }, [pathname, href, router]);

  // The page's main action ("Add to cart") becomes Telegram's MainButton.
  useEffect(() => {
    const app = telegramWebApp();
    if (!app) return;
    if (!primaryAction) {
      app.MainButton.hide();
      return;
    }
    const onClick = () => primaryAction.onClick();
    app.MainButton.setText(primaryAction.label);
    if (primaryAction.disabled) app.MainButton.disable();
    else app.MainButton.enable();
    app.MainButton.show();
    app.MainButton.onClick(onClick);
    return () => app.MainButton.offClick(onClick);
  }, [primaryAction]);

  return null;
}
