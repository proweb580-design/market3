'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthForm, Field, FooterLink, friendly } from '../../auth-form';
import { getSupabase, safeNext } from '../../../lib/supabase';

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'), '/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: e } = (await getSupabase()?.auth.signInWithPassword({ email: email.trim(), password })) ?? { error: null };
    if (e) {
      setError(friendly(e.message));
      setBusy(false);
      return;
    }
    router.replace(next);
  }

  const q = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthForm
      title="Sign in"
      text="Your orders, wishlist and Telegram link live in your account."
      submit="Sign in"
      busy={busy}
      error={error}
      onSubmit={submit}
      footer={
        <>
          <span>No account? <FooterLink href={`/register${q}`}>Create one</FooterLink></span>
          <FooterLink href="/forgot-password">Forgot your password?</FooterLink>
        </>
      }
    >
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
    </AuthForm>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
