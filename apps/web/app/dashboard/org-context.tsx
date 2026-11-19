'use client';

import { createContext, use } from 'react';

export interface Org {
  id: string;
  slug: string;
  name: string;
  role: { key: string; name: string };
  /** ISO 4217 code of the store's prices. */
  currency: string;
}

const OrgContext = createContext<Org | null>(null);
export const OrgProvider = OrgContext.Provider;

export function useOrg() {
  const org = use(OrgContext);
  if (!org) throw new Error('useOrg must be used inside the organization layout');
  return org;
}
