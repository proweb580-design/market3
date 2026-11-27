import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PLAN_FEATURES, type PlanFeatureKey } from '@repo/shared';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { LIVE_STATUSES } from './period.js';

export type LimitKey = { [K in PlanFeatureKey]: (typeof PLAN_FEATURES)[K]['kind'] extends 'limit' ? K : never }[PlanFeatureKey];
export type FlagKey = Exclude<PlanFeatureKey, LimitKey>;

export interface Entitlements {
  plan: { id: string; code: string; name: string } | null;
  subscription: { id: string; status: string; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; trialEndsAt: Date | null } | null;
  /** enabled flag per feature; limit: null = unlimited (only meaningful for limit features). */
  features: Record<string, { enabled: boolean; limit: number | null }>;
}

/** 402: the action is allowed by role, but not by the organization's plan. */
export class PlanRestrictionException extends HttpException {
  constructor(message: string, details: Record<string, unknown>) {
    super({ message, details: { code: 'PLAN_RESTRICTION', ...details } }, HttpStatus.PAYMENT_REQUIRED);
  }
}

/**
 * What an organization's current plan allows, and how much of it is used.
 * The server is the only source of truth for this — the frontend just renders the answer.
 * Limits are "soft": exceeding them after a downgrade deletes nothing, it only blocks creating more.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly db: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async forOrganization(organizationId: string): Promise<Entitlements> {
    const sub = await this.db.subscription.findFirst({
      where: { organizationId, status: { in: [...LIVE_STATUSES] } },
      include: { plan: { include: { features: true } } },
    });
    // No live subscription (e.g. an organization created before billing existed) → Free plan rules.
    const plan = sub?.plan ?? (await this.db.plan.findUnique({ where: { code: 'FREE' }, include: { features: true } }));
    const features: Entitlements['features'] = {};
    for (const key of Object.keys(PLAN_FEATURES)) features[key] = { enabled: false, limit: 0 };
    for (const f of plan?.features ?? []) features[f.featureKey] = { enabled: f.enabled, limit: f.enabled ? f.limitValue : 0 };
    // Single-owner mode: the plan is shown as is, but nothing is gated or capped by it.
    if (!this.env.PLAN_LIMITS) for (const key of Object.keys(features)) features[key] = { enabled: true, limit: null };
    return {
      plan: plan ? { id: plan.id, code: plan.code, name: plan.name } : null,
      subscription: sub
        ? { id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, trialEndsAt: sub.trialEndsAt }
        : null,
      features,
    };
  }

  async usage(organizationId: string, key: LimitKey): Promise<number> {
    switch (key) {
      case 'products.max':
        return this.db.product.count({ where: { organizationId } });
      case 'members.max': {
        // Pending invitations count too, otherwise a plan could be overrun by inviting many people at once.
        const [members, invites] = await Promise.all([
          this.db.organizationMember.count({ where: { organizationId, status: 'ACTIVE' } }),
          this.db.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
        ]);
        return members + invites;
      }
      case 'storage.mb': {
        const { _sum } = await this.db.mediaFile.aggregate({ where: { organizationId }, _sum: { sizeBytes: true } });
        return Math.ceil(Number(_sum.sizeBytes ?? 0n) / 1_048_576);
      }
      case 'api.requests_per_day':
        return this.db.apiLog.count({
          where: { apiKey: { organizationId }, createdAt: { gt: new Date(Date.now() - 86_400_000) } },
        });
    }
  }

  async assertFeature(organizationId: string, key: FlagKey, ent?: Entitlements) {
    const e = ent ?? (await this.forOrganization(organizationId));
    if (!e.features[key]?.enabled) {
      throw new PlanRestrictionException(`Your plan does not include ${PLAN_FEATURES[key].description.toLowerCase()}`, { feature: key, plan: e.plan?.code });
    }
  }

  /**
   * Throws 402 when adding `adding` more units would exceed the plan's limit.
   * shortcut: count-then-insert is not atomic — two simultaneous requests can overshoot by one; lock per org if that matters.
   */
  async assertLimit(organizationId: string, key: LimitKey, adding = 1, ent?: Entitlements) {
    const e = ent ?? (await this.forOrganization(organizationId));
    const limit = e.features[key] ? e.features[key].limit : 0; // null = unlimited; a missing feature = 0
    if (limit === null) return;
    const used = await this.usage(organizationId, key);
    if (used + adding > limit) {
      throw new PlanRestrictionException(`Plan limit reached: ${PLAN_FEATURES[key].description.toLowerCase()}`, {
        limit: key,
        allowed: limit,
        used,
        plan: e.plan?.code,
      });
    }
  }
}
