'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FooterLink } from '../../../auth-form';
import { getSupabase, safeNext } from '../../../../lib/supabase';

/**
 * Landing page of the links in Supabase emails (confirm address, reset password). The Supabase client exchanges the
 * one-time code in the URL for a session when it starts; we only wait for that and move on.
 */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const failure = params.get('error_description') ?? hash.get('error_description');
    if (failure) return setError(failure.replace(/\+/g, ' '));
    if (!supabase) return setError('Sign-in is not configured on this deployment.');
    void supabase.auth.getSession().then(({ data, error: e }) => {
      if (e || !data.session) return setError(e?.message ?? 'This link is invalid or has expired.');
      router.replace(safeNext(params.get('next')));
    });
  }, [params, router]);

  if (!error) return <p className="text-xs text-muted-foreground" aria-busy="true">Confirming…</p>;
  return (
    <>
      <h1 className="title-xl text-4xl">Link problem</h1>
      <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>
      <div className="mt-6 flex flex-col gap-1 text-xs"><FooterLink href="/login">Sign in</FooterLink><FooterLink href="/forgot-password">Request a new reset link</FooterLink></div>
    </>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
