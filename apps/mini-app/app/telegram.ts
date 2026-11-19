/**
 * Thin typing of the official Telegram WebApp script (https://core.telegram.org/bots/webapps),
 * loaded in the root layout from telegram.org. Only what this app uses.
 */
export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: Partial<Record<'bg_color' | 'text_color' | 'hint_color' | 'link_color' | 'button_color' | 'button_text_color' | 'secondary_bg_color', string>>;
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  onEvent(event: 'themeChanged', cb: () => void): void;
  offEvent(event: 'themeChanged', cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: {
    setText(text: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

/** The WebApp object only when actually running inside Telegram (initData present), else null (plain browser). */
export function telegramWebApp(): TelegramWebApp | null {
  const app = (globalThis as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return app?.initData ? app : null;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const key = (store: string) => `tg-session:${store}`;

/**
 * Telegram signs initData once per launch and the API accepts it once, so the session is kept for this launch
 * in sessionStorage (cleared when the Mini App closes) and refreshed with the rotating refresh token.
 */
const inflight = new Map<string, Promise<Session | null>>();

export function telegramSession(store: string, initData: string): Promise<Session | null> {
  // initData is single-use on the server: concurrent callers must share one sign-in request.
  let pending = inflight.get(store);
  if (!pending) {
    pending = obtain(store, initData).finally(() => inflight.delete(store));
    inflight.set(store, pending);
  }
  return pending;
}

async function obtain(store: string, initData: string): Promise<Session | null> {
  const saved = read(store);
  if (saved && saved.expiresAt - 30_000 > Date.now()) return saved;
  if (saved) {
    const refreshed = await post('/api/v1/telegram/refresh', { refreshToken: saved.refreshToken });
    if (refreshed) return write(store, refreshed);
  }
  const fresh = await post('/api/v1/telegram/auth', { initData, store });
  return fresh ? write(store, fresh) : null;
}

async function post(path: string, body: object) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return null;
  return (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
}

function read(store: string): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(key(store)) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

function write(store: string, t: { accessToken: string; refreshToken: string; expiresIn: number }): Session {
  const s = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
  try {
    sessionStorage.setItem(key(store), JSON.stringify(s));
  } catch {
    // storage blocked: the session still works for this page view
  }
  return s;
}
