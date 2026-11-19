'use client';

import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { ActionButton, Async, PageHead, useLoad } from '../../kit';
import { Thumb, UploadButton, type MediaItem } from '../../media-lib';
import { useOrg } from '../../org-context';

export default function MediaPage() {
  const org = useOrg();
  const lib = useLoad<{ items: MediaItem[]; total: number }>(`/organizations/${org.id}/media?pageSize=100`);

  return (
    <>
      <PageHead title="Media" subtitle="Photos and audio for products and your storefront." actions={<><UploadButton orgId={org.id} onUploaded={() => void lib.reload()} /><UploadButton orgId={org.id} accept="audio" onUploaded={() => void lib.reload()} /></>} />
      <Async state={lib}>
        {({ items }) =>
          items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No files yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {items.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 text-[11px]">
                  <Thumb media={m} className="aspect-square w-full" />
                  <span className="text-muted-foreground">{m.mimeType.split('/')[1]} · {(m.sizeBytes / 1024).toFixed(0)} KB</span>
                  {m.url && <Button asChild variant="ghost" size="sm"><a href={m.url} target="_blank" rel="noopener noreferrer">Open</a></Button>}
                  <ActionButton variant="outline" confirm="Delete this file? Files used by a product or the storefront cannot be deleted." run={async () => { await api(`/organizations/${org.id}/media/${m.id}`, { method: 'DELETE' }); await lib.reload(); }}>Delete</ActionButton>
                </li>
              ))}
            </ul>
          )
        }
      </Async>
    </>
  );
}
