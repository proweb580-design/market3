import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@repo/shared';
import type { AppRequest, Principal, Tenant } from './principal.js';

/**
 * Every route must declare how it is protected — a route with none of these is rejected (fail closed):
 *  - @Public()                    no authentication (health, public storefront reads)
 *  - @OptionalAuth()              public, but a credential, when sent, is verified and becomes req.principal (guest checkout)
 *  - @UserOnly()                  any signed-in *user* (API keys are refused) — own account, onboarding
 *  - @MemberOnly()                signed-in user who is an active member of :orgId
 *  - @RequirePermissions(...keys) user or API key holding ALL listed permissions
 */
export const IS_PUBLIC = 'access:public';
export const USER_ONLY = 'access:userOnly';
export const MEMBER_ONLY = 'access:memberOnly';
export const PERMISSIONS_META = 'access:permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const OPTIONAL_AUTH = 'access:optionalAuth';
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
export const UserOnly = () => SetMetadata(USER_ONLY, true);
export const MemberOnly = () => SetMetadata(MEMBER_ONLY, true);
export const RequirePermissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSIONS_META, keys);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<AppRequest>().principal!;
});

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): Tenant => {
  return ctx.switchToHttp().getRequest<AppRequest>().tenant!;
});

/** The raw request, for services that need the per-request access cache or client IP. */
export const Req = createParamDecorator((_: unknown, ctx: ExecutionContext): AppRequest => {
  return ctx.switchToHttp().getRequest<AppRequest>();
});
