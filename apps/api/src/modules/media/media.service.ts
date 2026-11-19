import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAudio, maxBytesFor, type UploadIntent } from '@repo/shared';
import type { AppRequest, Tenant } from '../../common/principal.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { mediaUrl } from '../catalog/view.js';
import { OBJECT_STORAGE, StorageError, type ObjectStorage } from './object-storage.js';

const TICKET_TTL_MS = 15 * 60_000;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

interface Ticket extends UploadIntent {
  org: string;
  key: string;
  exp: number;
}

/**
 * Two-step upload without the API ever touching file bytes:
 *  1. `intent`  — validates type/size/plan, returns a signed upload token and a signed ticket (what was agreed);
 *  2. `confirm` — checks the object is really in storage with the agreed size/type, then records it.
 * Nothing is recorded for an upload that never happened, and the ticket can't be altered or reused for another store.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
  ) {}

  private requireStorage() {
    if (!this.storage || !this.env.JWT_SECRET) throw new ServiceUnavailableException('File storage is not configured (SUPABASE_SERVICE_ROLE_KEY)');
    return this.storage;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.env.JWT_SECRET!).update(`media-ticket:${payload}`).digest('base64url');
  }

  private seal(ticket: Ticket) {
    const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private open(raw: string, organizationId: string): Ticket {
    const [payload = '', signature = ''] = raw.split('.');
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnprocessableEntityException('Invalid upload ticket');
    const ticket = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Ticket;
    if (ticket.org !== organizationId) throw new UnprocessableEntityException('Invalid upload ticket'); // another store's ticket
    if (ticket.exp < Date.now()) throw new UnprocessableEntityException('Upload ticket expired — start the upload again');
    return ticket;
  }

  async intent(tenant: Tenant, input: UploadIntent) {
    const storage = this.requireStorage();
    const organizationId = tenant.organizationId;
    const ent = await this.entitlements.forOrganization(organizationId);
    if (isAudio(input.mimeType)) await this.entitlements.assertFeature(organizationId, 'music_player', ent);
    await this.entitlements.assertLimit(organizationId, 'storage.mb', Math.ceil(input.sizeBytes / 1_048_576), ent);

    const key = `${organizationId}/${randomUUID()}.${EXT[input.mimeType]}`;
    try {
      await storage.ensureBucket();
      const { token } = await storage.createUpload(key);
      return { path: key, token, ticket: this.seal({ ...input, org: organizationId, key, exp: Date.now() + TICKET_TTL_MS }) };
    } catch (error) {
      if (error instanceof StorageError) throw new BadGatewayException('File storage is unavailable, please try again');
      throw error;
    }
  }

  async confirm(req: AppRequest, tenant: Tenant, rawTicket: string) {
    const storage = this.requireStorage();
    const organizationId = tenant.organizationId;
    const t = this.open(rawTicket, organizationId);

    const existing = await this.db.mediaFile.findUnique({ where: { storageKey: t.key } });
    if (existing) return this.dto(existing); // confirming twice is harmless

    let info;
    try {
      info = await storage.stat(t.key);
    } catch (error) {
      if (error instanceof StorageError) throw new BadGatewayException('File storage is unavailable, please try again');
      throw error;
    }
    if (!info) throw new UnprocessableEntityException('The file was not uploaded');
    // What arrived must be what was agreed; otherwise it is deleted instead of being attached to the store.
    if (info.size !== t.sizeBytes || !info.contentType.toLowerCase().startsWith(t.mimeType) || info.size > maxBytesFor(t.mimeType)) {
      await storage.remove(t.key).catch(() => undefined);
      throw new UnprocessableEntityException('The uploaded file does not match what was declared');
    }

    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.mediaFile.create({
        data: { organizationId, storageKey: t.key, mimeType: t.mimeType, sizeBytes: BigInt(t.sizeBytes), width: t.width ?? null, height: t.height ?? null, alt: t.alt ?? null },
      });
      await this.audit.record(req, { action: 'media.uploaded', organizationId, entityType: 'media', entityId: created.id, metadata: { mimeType: t.mimeType, sizeBytes: t.sizeBytes } }, tx);
      return created;
    });
    return this.dto(row);
  }

  async remove(req: AppRequest, tenant: Tenant, mediaId: string) {
    const organizationId = tenant.organizationId;
    const file = await this.db.mediaFile.findFirst({
      where: { id: mediaId, organizationId },
      include: { _count: { select: { productMedia: true, collectionImages: true, lookbookItems: true, trackAudio: true, trackCovers: true } } },
    });
    if (!file) throw new NotFoundException('Media not found');
    const uses = Object.values(file._count).reduce((a, b) => a + b, 0);
    if (uses > 0) throw new ConflictException({ message: 'This file is still used by products, collections or the storefront', details: { uses } });
    await this.db.$transaction(async (tx) => {
      await tx.mediaFile.delete({ where: { id: file.id } });
      await this.audit.record(req, { action: 'media.deleted', organizationId, entityType: 'media', entityId: file.id }, tx);
    });
    // The row is gone first: a failed object delete leaves an orphan file, never a broken reference.
    await this.storage?.remove(file.storageKey).catch(() => undefined);
  }

  private dto(f: { id: string; storageKey: string; mimeType: string; alt: string | null; width: number | null; height: number | null; sizeBytes: bigint }) {
    return { id: f.id, mimeType: f.mimeType, alt: f.alt, width: f.width, height: f.height, sizeBytes: Number(f.sizeBytes), url: mediaUrl(this.env.SUPABASE_URL, f.storageKey) };
  }
}
