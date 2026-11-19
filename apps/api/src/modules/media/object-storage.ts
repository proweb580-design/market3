import { AUDIO_TYPES, IMAGE_TYPES, MAX_AUDIO_BYTES } from '@repo/shared';

/**
 * Where uploaded files live. The API never receives file bytes: it hands the browser a one-time signed upload
 * URL and later checks that the object really is there. Supabase Storage is the implementation; tests use a fake.
 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectInfo {
  size: number;
  contentType: string;
}

export interface ObjectStorage {
  /** Creates the public bucket if it doesn't exist yet. Idempotent. */
  ensureBucket(): Promise<void>;
  /** Signed upload token for `path` (the browser uploads with it, no account key involved). */
  createUpload(path: string): Promise<{ token: string }>;
  /** Metadata of the stored object, or null if it isn't there. */
  stat(path: string): Promise<ObjectInfo | null>;
  remove(path: string): Promise<void>;
}

export class StorageError extends Error {}

/** Supabase Storage over its REST API, using the service-role key (server only — never sent to a browser). */
export class SupabaseObjectStorage implements ObjectStorage {
  private ready = false;

  constructor(
    private readonly projectUrl: string,
    private readonly serviceKey: string,
    private readonly bucket = 'media',
  ) {}

  private get base() {
    return `${this.projectUrl.replace(/\/+$/, '')}/storage/v1`;
  }

  private headers(json = false): Record<string, string> {
    return { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }

  private encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  async ensureBucket() {
    if (this.ready) return;
    // The bucket itself caps size and type, so a signed upload link cannot be used to store anything else or anything bigger
    // (the confirm step re-checks, but unconfirmed uploads would otherwise sit in storage unlimited).
    const body = JSON.stringify({ id: this.bucket, name: this.bucket, public: true, file_size_limit: MAX_AUDIO_BYTES, allowed_mime_types: [...IMAGE_TYPES, ...AUDIO_TYPES] });
    let res = await fetch(`${this.base}/bucket`, { method: 'POST', headers: this.headers(true), body });
    // Already there (maybe created earlier without limits): bring it to the same settings.
    if (!res.ok && /exist|duplicate/i.test(await res.text())) res = await fetch(`${this.base}/bucket/${this.bucket}`, { method: 'PUT', headers: this.headers(true), body });
    if (!res.ok) throw new StorageError(`Could not prepare the "${this.bucket}" bucket (${res.status})`);
    this.ready = true;
  }

  async createUpload(path: string) {
    const res = await fetch(`${this.base}/object/upload/sign/${this.bucket}/${this.encode(path)}`, { method: 'POST', headers: this.headers(true), body: '{}' });
    if (!res.ok) throw new StorageError(`Could not create an upload URL (${res.status})`);
    const body = (await res.json()) as { url?: string; token?: string };
    const token = body.token ?? (body.url ? new URL(body.url, this.base).searchParams.get('token') : null);
    if (!token) throw new StorageError('Storage returned no upload token');
    return { token };
  }

  async stat(path: string) {
    const res = await fetch(`${this.base}/object/public/${this.bucket}/${this.encode(path)}`, { method: 'HEAD' });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new StorageError(`Could not check the uploaded file (${res.status})`);
    return { size: Number(res.headers.get('content-length') ?? 0), contentType: res.headers.get('content-type') ?? '' };
  }

  async remove(path: string) {
    const res = await fetch(`${this.base}/object/${this.bucket}/${this.encode(path)}`, { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404) throw new StorageError(`Could not delete the file (${res.status})`);
  }
}
