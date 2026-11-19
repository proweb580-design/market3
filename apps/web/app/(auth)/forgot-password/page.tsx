'use client';

import { useState } from 'react';
import { AuthForm, Field, FooterLink, friendly } from '../../auth-form';
import { getSupabase } from '../../../lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: e } = (await getSupabase()?.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` })) ?? { error: null };
    setBusy(false);
    if (e) return setError(friendly(e.message));
    // Same message whether or not the address has an account.
    setNotice('If an account exists for this email, we sent a link to set a new password.');
  }

  return (
    <AuthForm
      title="Reset password"
      text="We’ll email you a link to choose a new one."
      submit="Send link"
      busy={busy}
      error={error}
      notice={notice}
      onSubmit={submit}
      footer={<FooterLink href="/login">Back to sign in</FooterLink>}
    >
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
    </AuthForm>
  );
}
