'use client';

import Link from 'next/link';
import { Button } from '@repo/ui/components/ui/button';
import { Async, PageHead, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Row {
  id: string;
  slug: string;
  title: string;
  isPublished: boolean;
  productCount: number;
}

export default function CollectionsPage() {
  const org = useOrg();
  const list = useLoad<Row[]>(`/organizations/${org.id}/collections`);
  return (
    <>
      <PageHead title="Коллекции" subtitle="Подборки товаров: новинки, сезон, категории." actions={<Button asChild><Link href={`/dashboard/${org.slug}/collections/new`}>+ Новая коллекция</Link></Button>} />
      <Async state={list}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Коллекций пока нет.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={`/dashboard/${org.slug}/collections/${c.id}`} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted">
                    <b>{c.title}</b>
                    <span className="text-muted-foreground">товаров: {c.productCount} · {c.isPublished ? 'показывается' : 'скрыта'}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
