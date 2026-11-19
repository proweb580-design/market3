'use client';

import { createContext, use, useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { useLoad } from '../dashboard/kit';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A paginated admin list: `params` are extra query values (filters); changing them returns to page 1. */
export function usePaged<T>(path: string, params: Record<string, string> = {}, pageSize = 25) {
  const [page, setPage] = useState(1);
  const filterKey = JSON.stringify(params);
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setPage(1);
  }
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)) });
  const state = useLoad<Page<T>>(`${path}?${query.toString()}`);
  return { ...state, page, setPage };
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages} · {total} total</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

/** Platform permissions of the signed-in admin, used to show only the sections they may open. */
export const PermsContext = createContext<ReadonlySet<string>>(new Set());
export const useCan = () => {
  const perms = use(PermsContext);
  return (key: string) => perms.has(key);
};

export const money = (minor: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
