'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { api, ApiError } from '../../lib/api';

/** Small building blocks shared by the dashboard pages. Plain on purpose — styling is refined later. */

export const STATUS_LABEL: Record<string, string> = { PENDING_PAYMENT: 'Ждёт оплаты', PAID: 'Оплачен — отправить', FULFILLED: 'Отправлен', CANCELED: 'Отменён', REFUNDED: 'Возврат' };
export const PRODUCT_STATUS: Record<string, string> = { ACTIVE: 'В продаже', DRAFT: 'Черновик', ARCHIVED: 'В архиве' };
export const SOURCE_LABEL: Record<string, string> = { WEB: 'сайт', TELEGRAM: 'Telegram', API: 'API' };
export const PAYMENT_LABEL: Record<string, string> = { PENDING: 'ожидает', SUCCEEDED: 'оплачено', FAILED: 'ошибка', CANCELED: 'отменено', REFUNDED: 'возвращено', PARTIALLY_REFUNDED: 'частичный возврат' };
export const SUBSCRIPTION_LABEL: Record<string, string> = { TRIALING: 'пробный период', ACTIVE: 'активен', PAST_DUE: 'просрочен', CANCELED: 'отменён', EXPIRED: 'истёк' };
const ROLE_LABEL: Record<string, string> = { ORG_OWNER: 'Владелец', ORG_ADMIN: 'Администратор', ORG_MANAGER: 'Менеджер', ORG_STAFF: 'Сотрудник' };
export const roleName = (r: { key: string; name: string }) => ROLE_LABEL[r.key] ?? r.name;
export const FEATURE_LABEL: Record<string, string> = {
  'products.max': 'Товаров в каталоге',
  'members.max': 'Сотрудников',
  'storage.mb': 'Место для фото, МБ',
  'api.requests_per_day': 'Запросов к API в день',
  api_access: 'API и ключи доступа',
  telegram_mini_app: 'Магазин внутри Telegram',
  custom_domain: 'Свой домен',
  lookbook: 'Лукбук',
  music_player: 'Музыкальный плеер',
  drop_countdown: 'Отсчёт до дропа',
  remove_branding: 'Без логотипа платформы',
};

export const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');
export const dateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.');

/** Loads `path` from the API; `null` skips loading. `reload()` refetches. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const load = useCallback(async () => {
    if (path === null) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function PageHead({ title, actions, subtitle }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="title-xl text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export const ErrorLine = ({ error }: { error: string | null }) => (error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null);

export function Loading({ what = 'Загрузка' }: { what?: string }) {
  return <p className="text-xs text-muted-foreground" aria-busy="true">{what}…</p>;
}

/** Wraps a loader result: error, spinner, or the content. */
export function Async<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error && !state.data) return <ErrorLine error={state.error} />;
  if (!state.data) return <Loading />;
  return <>{children(state.data)}</>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="label-xs">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextField({ label, value, onChange, type = 'text', hint, placeholder, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; placeholder?: string; maxLength?: number }) {
  return (
    <Field label={label} hint={hint}>
      <Input type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function TextArea({ label, value, onChange, rows = 4, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
    </Field>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="mb-6 rounded-md border border-border p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="label-xs font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Button that runs an async action, shows progress and reports errors in place. */
export function ActionButton({ children, run, variant = 'default', confirm: ask, disabled }: { children: ReactNode; run: () => Promise<unknown>; variant?: 'default' | 'outline' | 'destructive' | 'ghost'; confirm?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        disabled={busy || disabled}
        onClick={async () => {
          if (ask && !window.confirm(ask)) return;
          setBusy(true);
          setError(null);
          try {
            await run();
          } catch (e) {
            setError(errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Подождите…' : children}
      </Button>
      <ErrorLine error={error} />
    </span>
  );
}

export const Plain = Label;

// Money and slug helpers live in @repo/shared (tested there).
export { fromMinor, slugify, toMinor } from '@repo/shared';
