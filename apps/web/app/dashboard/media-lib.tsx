'use client';

import { createContext, use, useRef, useState, type ReactNode } from 'react';
import { AUDIO_TYPES, IMAGE_TYPES, maxBytesFor } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../lib/api';
import { getSupabase } from '../../lib/supabase';
import { ErrorLine, Loading, errText, useLoad } from './kit';

export interface MediaItem {
  id: string;
  mimeType: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  url: string | null;
  /** Vector demo art (demo store only). */
  art: unknown;
}

type Library = ReturnType<typeof useLoad<{ items: MediaItem[]; total: number }>>;
const LibraryContext = createContext<Library | null>(null);

/** Loads the store's media library once for the whole dashboard; every picker and the media page share it. */
export function LibraryProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const lib = useLoad<{ items: MediaItem[]; total: number }>(`/organizations/${orgId}/media?pageSize=100`);
  return <LibraryContext value={lib}>{children}</LibraryContext>;
}

export function useLibrary() {
  const lib = use(LibraryContext);
  if (!lib) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return lib;
}

const isImage = (m: MediaItem) => m.mimeType.startsWith('image/') && !!m.url;

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return {}; // not decodable here (e.g. audio): dimensions are optional
  }
}

/**
 * Browser → Supabase Storage upload in three calls: ask the API for a signed upload token (it checks type, size and plan),
 * upload the file straight to storage, tell the API it arrived (it verifies the file and records it).
 */
export async function uploadMedia(orgId: string, file: File, alt?: string): Promise<MediaItem> {
  const allowed = [...IMAGE_TYPES, ...AUDIO_TYPES] as readonly string[];
  if (!allowed.includes(file.type)) throw new Error('Такой формат не подходит. Нужны фото JPEG, PNG, WebP, AVIF или GIF (или аудио MP3/M4A/OGG/WAV).');
  if (file.size > maxBytesFor(file.type)) throw new Error(`Файл слишком большой (максимум ${Math.round(maxBytesFor(file.type) / 1_048_576)} МБ).`);
  const supabase = getSupabase();
  if (!supabase) throw new Error('Загрузка файлов не настроена (Supabase).');

  const dims = await imageSize(file);
  const intent = await api<{ path: string; token: string; ticket: string }>(`/organizations/${orgId}/media/upload-url`, {
    method: 'POST',
    body: { mimeType: file.type, sizeBytes: file.size, ...dims, ...(alt ? { alt } : {}) },
  });
  const { error } = await supabase.storage.from('media').uploadToSignedUrl(intent.path, intent.token, file, { contentType: file.type });
  if (error) throw new Error(`Не удалось загрузить: ${error.message}`);
  return api<MediaItem>(`/organizations/${orgId}/media`, { method: 'POST', body: { ticket: intent.ticket } });
}

export function UploadButton({ orgId, onUploaded, accept = 'image' }: { orgId: string; onUploaded: (m: MediaItem) => void; accept?: 'image' | 'audio' }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) onUploaded(await uploadMedia(orgId, file));
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <input ref={input} type="file" hidden multiple={accept === 'image'} accept={(accept === 'image' ? IMAGE_TYPES : AUDIO_TYPES).join(',')} onChange={(e) => void pick(e.target.files)} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Загружаем…' : accept === 'image' ? 'Загрузить фото' : 'Загрузить аудио'}</Button>
      <ErrorLine error={error} />
    </span>
  );
}

export function Thumb({ media, className = 'size-16' }: { media: MediaItem; className?: string }) {
  if (isImage(media)) return <img src={media.url!} alt={media.alt ?? ''} className={`${className} rounded-sm object-cover`} />; // eslint-disable-line @next/next/no-img-element
  return <span className={`${className} flex items-center justify-center rounded-sm bg-muted text-[10px] text-muted-foreground`}>{media.mimeType.startsWith('audio/') ? 'аудио' : 'арт'}</span>;
}

/** The store's media library as a list you can pick from (single or several), with upload built in. */
export function MediaPicker({ orgId, selected, onChange, multiple = true, kind = 'image', max = 20 }: { orgId: string; selected: string[]; onChange: (ids: string[]) => void; multiple?: boolean; kind?: 'image' | 'audio'; max?: number }) {
  const lib = useLibrary();
  const [open, setOpen] = useState(false);
  const items = (lib.data?.items ?? []).filter((m) => (kind === 'audio' ? m.mimeType.startsWith('audio/') : !m.mimeType.startsWith('audio/')));
  const byId = new Map((lib.data?.items ?? []).map((m) => [m.id, m]));

  const toggle = (id: string) => {
    if (selected.includes(id)) return onChange(selected.filter((s) => s !== id));
    onChange(multiple ? [...selected, id].slice(0, max) : [id]);
    if (!multiple) setOpen(false);
  };
  const move = (i: number, d: number) => {
    const next = [...selected];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2">
        {selected.map((id, i) => {
          const m = byId.get(id);
          return (
            <li key={id} className="flex flex-col items-center gap-1 text-[10px]">
              {m ? <Thumb media={m} /> : <span className="size-16 rounded-sm bg-muted" />}
              <span className="flex gap-1">
                {multiple && i > 0 && <button type="button" aria-label="Раньше" onClick={() => move(i, -1)}>←</button>}
                {multiple && i < selected.length - 1 && <button type="button" aria-label="Позже" onClick={() => move(i, 1)}>→</button>}
                <button type="button" aria-label="Убрать" onClick={() => onChange(selected.filter((s) => s !== id))}>✕</button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-start gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)}>{open ? 'Закрыть' : kind === 'audio' ? 'Выбрать аудио' : 'Выбрать из загруженных'}</Button>
        <UploadButton orgId={orgId} accept={kind} onUploaded={(m) => { lib.setData((d) => ({ items: [m, ...(d?.items ?? [])], total: (d?.total ?? 0) + 1 })); toggle(m.id); }} />
      </div>
      {open && (lib.loading ? <Loading /> : items.length === 0 ? <p className="text-xs text-muted-foreground">Пока ничего не загружено — загрузите файл.</p> : (
        <ul className="flex max-h-60 flex-wrap gap-2 overflow-y-auto rounded-md border border-border p-2">
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => toggle(m.id)} aria-pressed={selected.includes(m.id)} className={`rounded-sm border-2 ${selected.includes(m.id) ? 'border-foreground' : 'border-transparent'}`}>
                <Thumb media={m} />
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
