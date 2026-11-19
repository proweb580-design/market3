'use client';

import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
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
export function AuthForm({ title, text, submit, busy, error, notice, onSubmit, children, footer }: { title: string; text?: string; submit: string; busy: boolean; error?: string | null; notice?: string | null; onSubmit: () => void; children: ReactNode; footer?: ReactNode }) {
  const { configured } = useAuth();
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
