'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../auth-provider';

/** Landing page of an invitation link: sign in (or register), then accept. */
function Accept() {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();
  const { status } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite?token=${encodeURIComponent(token ?? '')}`;

  useEffect(() => {
    if (status === 'signedOut' && token) router.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [status, token, router, here]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api('/invitations/accept', { method: 'POST', body: { token } });
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  if (!token) return <p className="text-xs text-destructive">This invitation link is incomplete.</p>;
  return (
    <>
      <h1 className="title-xl text-4xl">Join a store</h1>
      <p className="mt-2 text-xs text-muted-foreground">You were invited to work in a store. Accept to get access.</p>
      {error && <p role="alert" className="mt-4 text-xs text-destructive">{error}</p>}
      <Button className="mt-6" onClick={accept} disabled={busy || status !== 'signedIn'}>{busy ? 'Please wait…' : 'Accept invitation'}</Button>
      <p className="mt-6 text-xs"><Link href="/dashboard" className="underline">Go to the dashboard</Link></p>
    </>
  );
}

export default function InvitePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-16">
      <Suspense>
        <Accept />
      </Suspense>
    </main>
  );
}
