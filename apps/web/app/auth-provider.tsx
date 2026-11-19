'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { getSupabase } from '../lib/supabase';

interface AuthValue {
  /** `loading` until Supabase has restored the session from the browser. */
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  configured: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabase();
  const [state, setState] = useState<{ status: AuthValue['status']; session: Session | null }>({ status: 'loading', session: null });

  useEffect(() => {
    if (!supabase) {
      setState({ status: 'signedOut', session: null });
      return;
    }
    let live = true;
    void supabase.auth.getSession().then(({ data }) => live && setState({ status: data.session ? 'signedIn' : 'signedOut', session: data.session }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ status: session ? 'signedIn' : 'signedOut', session }));
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    // End our server-side session record first (needs the token), then Supabase's.
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await supabase?.auth.signOut();
  }, [supabase]);

  const value = useMemo(() => ({ ...state, configured: !!supabase, signOut }), [state, supabase, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
