'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../../auth-provider';
import { AuthForm, Field, FooterLink, friendly } from '../../auth-form';
import { getSupabase } from '../../../lib/supabase';

/** Opened from the email link (the callback page already turned it into a session). */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { status } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedOut') {
    return (
      <>
        <h1 className="title-xl text-4xl">Link expired</h1>
        <p className="mt-2 text-xs text-muted-foreground">This reset link is invalid or has already been used.</p>
        <div className="mt-6 text-xs"><FooterLink href="/forgot-password">Request a new link</FooterLink></div>
      </>
    );
  }

  async function submit() {
    setError(null);
    if (password.length < 8) return setError('Choose a password of at least 8 characters.');
    if (password !== repeat) return setError('The passwords do not match.');
    setBusy(true);
    const { error: e } = (await getSupabase()?.auth.updateUser({ password })) ?? { error: null };
    if (e) {
      setBusy(false);
      return setError(friendly(e.message));
    }
    router.replace('/account');
  }

  return (
    <AuthForm title="New password" submit="Save password" busy={busy || status === 'loading'} error={error} onSubmit={submit}>
      <Field id="password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
      <Field id="repeat" label="Repeat password" type="password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
    </AuthForm>
  );
}
