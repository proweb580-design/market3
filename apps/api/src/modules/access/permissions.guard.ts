import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC, MEMBER_ONLY, OPTIONAL_AUTH, PERMISSIONS_META, USER_ONLY } from '../../common/decorators.js';
import type { AppRequest } from '../../common/principal.js';
import { AccessService, isOrgPermission } from './access.service.js';

/**
 * Server-side authorization for every route. Fails closed: a route that declares no access rule is refused,
 * so forgetting a decorator can never silently expose an endpoint.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) || this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const principal = req.principal!;
    const userOnly = this.reflector.getAllAndOverride<boolean>(USER_ONLY, targets);
    const memberOnly = this.reflector.getAllAndOverride<boolean>(MEMBER_ONLY, targets);
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_META, targets);

    if (!userOnly && !memberOnly && !required) throw new ForbiddenException('Route has no access rule');

    if (userOnly || memberOnly) {
      if (principal.kind !== 'user') throw new ForbiddenException('This endpoint requires a signed-in user');
      if (memberOnly && !req.tenant) throw new ForbiddenException('Organization membership required');
    }
    if (!required) return true;

    for (const key of required) {
      if (!(await this.allowed(req, key))) throw new ForbiddenException(`Missing permission: ${key}`);
    }
    return true;
  }

  private async allowed(req: AppRequest, key: string): Promise<boolean> {
    const principal = req.principal!;
    const orgScoped = isOrgPermission(key);

    if (principal.kind === 'apiKey') {
      const { apiKey } = principal;
      if (!apiKey.scopes.includes(key)) return false;
      if (apiKey.organizationId) {
        // Organization keys only ever act inside their own organization.
        return orgScoped && req.tenant?.organizationId === apiKey.organizationId;
      }
      // Personal key: the key's scopes AND the owner's live permissions must both allow it.
      return principal.user ? this.userHolds(req, principal.user.id, key, orgScoped) : false;
    }
    return this.userHolds(req, principal.user.id, key, orgScoped);
  }

  private async userHolds(req: AppRequest, userId: string, key: string, orgScoped: boolean) {
    const platform = await this.access.platformAccess(req, userId);
    if (platform.isSuperAdmin) return true;
    if (orgScoped) return req.tenant?.permissions.has(key) ?? false;
    return platform.permissions.has(key);
  }
}
