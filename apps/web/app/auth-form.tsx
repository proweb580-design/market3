'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { getSupabase } from '../lib/supabase';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { useAuth } from './auth-provider';

export function Field({ id, label, type = 'text', value, onChange, autoComplete, hint }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="label-xs">{label}</Label>
      <Input id={id} name={id} type={type} value={value} autoComplete={autoComplete} required onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Shared frame for login / register / reset pages: heading, error + notice lines, one submit button. */
export function AuthForm({ title, text, submit, busy, error, notice, onSubmit, children, footer, googleNext }: { title: string; text?: string; submit: string; busy: boolean; error?: string | null; notice?: string | null; onSubmit: () => void; children: ReactNode; footer?: ReactNode; googleNext?: string }) {
  const { configured } = useAuth();
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Google sends the buyer back to /auth/callback, the same landing page the email links use.
  const google = async () => {
    setOauthError(null);
    const { error: e } = (await getSupabase()?.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(googleNext ?? '/')}` },
    })) ?? { error: null };
    if (e) setOauthError(friendly(e.message));
  };
  const handle = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <>
      <h1 className="title-xl text-4xl">{title}</h1>
      {text && <p className="mt-2 text-xs text-muted-foreground">{text}</p>}
      {!configured ? (
        <p role="alert" className="mt-8 text-xs text-destructive">Sign-in is not configured on this deployment (Supabase keys are missing).</p>
      ) : (
        <form onSubmit={handle} className="mt-8 flex flex-col gap-4">
          {children}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          {notice && <p role="status" className="text-xs">{notice}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Please wait…' : submit}</Button>
          {googleNext !== undefined && (
            <>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={google}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
                  <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9h-4v3.1A12 12 0 0 0 12 24z" />
                  <path fill="#FBBC05" d="M5.3 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z" />
                  <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
                </svg>
                Continue with Google
              </Button>
              {oauthError && <p role="alert" className="text-xs text-destructive">{oauthError}</p>}
            </>
          )}
        </form>
      )}
      {footer && <div className="mt-6 flex flex-col gap-1 text-xs text-muted-foreground">{footer}</div>}
    </>
  );
}

export const FooterLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="underline hover:text-foreground">{children}</Link>
);

/** Supabase errors are English technical strings; map the common ones to something a buyer can act on. */
export function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first — we sent you a link.';
  if (/already registered|already been registered/i.test(message)) return 'An account with this email already exists. Try signing in.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password/i.test(message) && /(least|short|weak)/i.test(message)) return 'Choose a longer password (at least 8 characters).';
  return message;
}
