'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { getSupabase } from '../../lib/supabase';
import { useAuth } from '../auth-provider';
import { TextField } from './kit';

const ruError = (message: string) =>
  /invalid login credentials/i.test(message) ? 'Неверный логин или пароль.'
  : /email not confirmed/i.test(message) ? 'Почта не подтверждена — откройте письмо со ссылкой.'
  : /rate limit|too many/i.test(message) ? 'Слишком много попыток. Подождите пару минут.'
  : `Не удалось войти: ${message}`;

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
    const { error: e } = (await getSupabase()?.auth.signInWithPassword({ email: login.trim(), password })) ?? { error: null };
    // On success the auth provider flips to signed-in and the dashboard renders in place of this form.
    if (e) {
      setError(ruError(e.message));
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
          <TextField label="Логин (email)" type="email" value={login} onChange={setLogin} />
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
