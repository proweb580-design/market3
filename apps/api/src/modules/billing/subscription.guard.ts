import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../../common/decorators.js';
import type { AppRequest } from '../../common/principal.js';
import { EntitlementsService, type FlagKey, type LimitKey } from './entitlements.service.js';

const FEATURE_META = 'billing:feature';
const LIMIT_META = 'billing:limit';

/** Route needs a plan feature, e.g. @RequireFeature('telegram_mini_app'). Only on /organizations/:orgId routes. */
export const RequireFeature = (key: FlagKey) => SetMetadata(FEATURE_META, key);
/** Route creates one more unit of a limited resource, e.g. @CheckLimit('members.max'). */
export const CheckLimit = (key: LimitKey) => SetMetadata(LIMIT_META, key);

/**
 * Centralised plan enforcement, run after authorization. Role says "may this person do it",
 * this says "does the organization's plan allow it". Also: organization API keys work only on plans
 * with API access, within the daily request quota.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) || this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets)) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const orgId = req.tenant?.organizationId;
    if (!orgId) return true;

    const feature = this.reflector.getAllAndOverride<FlagKey | undefined>(FEATURE_META, targets);
    const limit = this.reflector.getAllAndOverride<LimitKey | undefined>(LIMIT_META, targets);
    const viaKey = req.principal?.kind === 'apiKey';
    if (!feature && !limit && !viaKey) return true;

    const ent = await this.entitlements.forOrganization(orgId);
    if (viaKey) {
      await this.entitlements.assertFeature(orgId, 'api_access', ent);
      await this.entitlements.assertLimit(orgId, 'api.requests_per_day', 1, ent);
    }
    if (feature) await this.entitlements.assertFeature(orgId, feature, ent);
    if (limit) await this.entitlements.assertLimit(orgId, limit, 1, ent);
    return true;
  }
}
