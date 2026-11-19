'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { collectionInputSchema } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../../lib/api';
import { ActionButton, Async, Card, Check, ErrorLine, PageHead, TextArea, TextField, errText, slugify, useLoad } from '../../../kit';
import { MediaPicker } from '../../../media-lib';
import { useOrg } from '../../../org-context';

interface CollectionDto {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  sortOrder: number;
  image: { id: string } | null;
  productIds: string[];
}

function CollectionForm({ collection }: { collection: CollectionDto | null }) {
  const org = useOrg();
  const router = useRouter();
  const products = useLoad<{ items: { id: string; title: string }[] }>(`/organizations/${org.id}/products?pageSize=100&sort=title`);
  const [title, setTitle] = useState(collection?.title ?? '');
  const [slug, setSlug] = useState(collection?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!collection);
  const [description, setDescription] = useState(collection?.description ?? '');
  const [published, setPublished] = useState(collection?.isPublished ?? true);
  const [sortOrder, setSortOrder] = useState(String(collection?.sortOrder ?? 0));
  const [image, setImage] = useState<string[]>(collection?.image ? [collection.image.id] : []);
  const [productIds, setProductIds] = useState<string[]>(collection?.productIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleOf = new Map((products.data?.items ?? []).map((p) => [p.id, p.title]));
  const move = (i: number, d: number) => {
    const next = [...productIds];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setProductIds(next);
  };

  async function save() {
    setError(null);
    const parsed = collectionInputSchema.safeParse({ slug, title, description: description.trim() || null, imageId: image[0] ?? null, sortOrder: Number(sortOrder) || 0, isPublished: published, productIds });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'form'}: ${i.message}`).slice(0, 3).join(' · '));
    setBusy(true);
    try {
      await api(collection ? `/organizations/${org.id}/collections/${collection.id}` : `/organizations/${org.id}/collections`, { method: collection ? 'PUT' : 'POST', body: parsed.data });
      router.push(`/dashboard/${org.slug}/collections`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Card title="Details">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Title" value={title} onChange={(v) => { setTitle(v); if (!slugTouched) setSlug(slugify(v)); }} maxLength={80} />
          <TextField label="Address (slug)" value={slug} onChange={(v) => { setSlugTouched(true); setSlug(v.toLowerCase()); }} />
          <TextField label="Sort order" type="number" value={sortOrder} onChange={setSortOrder} />
          <div className="pt-5"><Check label="Published" checked={published} onChange={setPublished} /></div>
        </div>
        <div className="mt-3"><TextArea label="Description" rows={3} value={description} onChange={setDescription} /></div>
      </Card>
      <Card title="Cover image"><MediaPicker orgId={org.id} selected={image} onChange={setImage} multiple={false} /></Card>
      <Card title={`Products (${productIds.length})`}>
        {productIds.length > 0 && (
          <ol className="mb-3 flex flex-col gap-1 text-xs">
            {productIds.map((id, i) => (
              <li key={id} className="flex items-center gap-2">
                <span className="w-5 text-muted-foreground">{i + 1}.</span>
                <span className="flex-1 truncate">{titleOf.get(id) ?? id}</span>
                {i > 0 && <button type="button" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>}
                {i < productIds.length - 1 && <button type="button" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>}
                <button type="button" aria-label="Remove" onClick={() => setProductIds(productIds.filter((x) => x !== id))}>✕</button>
              </li>
            ))}
          </ol>
        )}
        <p className="label-xs mb-1 text-muted-foreground">Add products</p>
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {(products.data?.items ?? []).filter((p) => !productIds.includes(p.id)).map((p) => (
            <li key={p.id}><button type="button" className="text-xs hover:underline" onClick={() => setProductIds([...productIds, p.id])}>+ {p.title}</button></li>
          ))}
        </ul>
      </Card>
      <ErrorLine error={error} />
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : collection ? 'Save changes' : 'Create collection'}</Button>
        <Button asChild variant="ghost"><Link href={`/dashboard/${org.slug}/collections`}>Cancel</Link></Button>
        {collection && <span className="ml-auto"><ActionButton variant="destructive" confirm="Delete this collection? Its products stay in the catalogue." run={async () => { await api(`/organizations/${org.id}/collections/${collection.id}`, { method: 'DELETE' }); router.push(`/dashboard/${org.slug}/collections`); }}>Delete</ActionButton></span>}
      </div>
    </form>
  );
}

function Edit({ id }: { id: string }) {
  const org = useOrg();
  const c = useLoad<CollectionDto>(`/organizations/${org.id}/collections/${id}`);
  return <Async state={c}>{(data) => (<><PageHead title={data.title} /><CollectionForm collection={data} /></>)}</Async>;
}

export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  if (id === 'new') return (<><PageHead title="New collection" /><CollectionForm collection={null} /></>);
  return <Edit id={id} />;
}
