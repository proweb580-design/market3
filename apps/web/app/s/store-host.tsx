'use client';

import { useEffect } from 'react';
import { useStore } from '@repo/ui/storefront/store-context';
import { getAccessToken } from '../../lib/supabase';

/**
 * Tells the storefront who the signed-in web buyer is (their Supabase token), so orders and the wishlist
 * belong to the account. Signed out, the token is simply null and the store works as a guest.
 */
export function WebStoreHost() {
  const { setHost } = useStore();
  useEffect(() => {
    setHost({ getAuthToken: getAccessToken, openLink: (url) => window.location.assign(url) });
    return () => setHost(null);
  }, [setHost]);
  return null;
}
