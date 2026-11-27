'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api, ApiError } from '../../lib/api';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth-provider';
import { TextField } from './kit';

const ruError = (message: string) =>
  /invalid login credentials/i.test(message) ? 'Неверный логин или пароль.'
  : /email not confirmed/i.test(message) ? 'Почта не подтверждена — откройте письмо со ссылкой.'
  : /rate limit|too many/i.test(message) ? 'Слишком много попыток. Подождите пару минут.'
  : `Не удалось войти: ${message}`;

const shortLoginError = (e: unknown) =>
  !(e instanceof ApiError) ? 'Не удалось войти. Проверьте интернет и попробуйте ещё раз.'
  : e.status === 401 ? 'Неверный логин или пароль.'
  : e.status === 429 ? 'Слишком много попыток. Подождите пару минут.'
  : e.status === 503 ? 'Короткий логин на сервере не настроен — войдите по email.'
  : 'Сервис входа недоступен. Попробуйте позже.';

/** "admin" → the server swaps it for the owner's email and returns their Supabase session; an email signs in directly. */
async function signIn(login: string, password: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return 'Вход не настроен.';
  if (login.includes('@')) {
    const { error } = await supabase.auth.signInWithPassword({ email: login, password });
    return error ? ruError(error.message) : null;
  }
  try {
    const s = await api<{ accessToken: string; refreshToken: string }>('/auth/owner-login', { method: 'POST', body: { login, password } });
    const { error } = await supabase.auth.setSession({ access_token: s.accessToken, refresh_token: s.refreshToken });
    return error ? ruError(error.message) : null;
  } catch (e) {
    return shortLoginError(e);
  }
}

/** The owner's own door into the dashboard: login and password, nothing else. */
export function OwnerLogin() {
  const { configured } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const e = await signIn(login.trim(), password);
    // On success the auth provider flips to signed-in and the dashboard renders in place of this form.
    if (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="title-xl text-4xl">Вход в кабинет</h1>
      <p className="mt-2 text-xs text-muted-foreground">Для владельца магазина.</p>
      {!configured ? (
        <p role="alert" className="mt-8 text-xs text-destructive">Вход не настроен (нет ключей Supabase).</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-8 flex flex-col gap-4">
          <TextField label="Логин" value={login} onChange={setLogin} placeholder="admin" />
          <TextField label="Пароль" type="password" value={password} onChange={setPassword} />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !login || !password}>{busy ? 'Входим…' : 'Войти'}</Button>
          <a href="/forgot-password" className="text-xs text-muted-foreground underline hover:text-foreground">Забыли пароль?</a>
        </form>
      )}
    </main>
  );
}

export function SignOutButton({ className = '' }: { className?: string }) {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()} className={`text-muted-foreground hover:text-foreground ${className}`}>
      Выйти
    </button>
  );
}
