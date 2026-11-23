'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthForm, Field, FooterLink, friendly } from '../../auth-form';
import { getSupabase, safeNext } from '../../../lib/supabase';

function RegisterForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'), '/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    if (password !== repeat) return setError('The passwords do not match.');
    setBusy(true);
    const supabase = getSupabase();
    const { data, error: e } = (await supabase?.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    })) ?? { data: null, error: null };
    setBusy(false);
    if (e) return setError(friendly(e.message));
    if (data?.session) return router.replace(next); // email confirmation is off in this project
    // Supabase answers the same way for an already-registered email, so this never reveals who has an account.
    setNotice('Check your inbox: we sent a confirmation link. Open it to finish creating your account.');
  }

  const q = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  return (
    <AuthForm
      title="Create account"
      text="One account for every store on the platform."
      submit="Create account"
      busy={busy}
      error={error}
      notice={notice}
      onSubmit={submit}
      googleNext={next}
      footer={<span>Already registered? <FooterLink href={`/login${q}`}>Sign in</FooterLink></span>}
    >
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
      <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
      <Field id="repeat" label="Repeat password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
    </AuthForm>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
