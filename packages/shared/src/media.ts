import { z } from 'zod';

/** Upload rules shared by the API (enforcement) and the dashboard (early feedback). */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const;
export const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export const isAudio = (mime: string) => (AUDIO_TYPES as readonly string[]).includes(mime);
export const maxBytesFor = (mime: string) => (isAudio(mime) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES);

export const uploadIntentSchema = z
  .object({
    mimeType: z.enum([...IMAGE_TYPES, ...AUDIO_TYPES]),
    sizeBytes: z.number().int().min(1).max(MAX_AUDIO_BYTES),
    /** Pixel size for images (informational: used for gallery layout). */
    width: z.number().int().min(1).max(20_000).optional(),
    height: z.number().int().min(1).max(20_000).optional(),
    alt: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => v.sizeBytes <= maxBytesFor(v.mimeType), { message: 'File is too large', path: ['sizeBytes'] });
export type UploadIntent = z.infer<typeof uploadIntentSchema>;

export const confirmUploadSchema = z.object({ ticket: z.string().min(20).max(2000) }).strict();
