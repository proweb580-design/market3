import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../../common/decorators.js';
import type { AppRequest } from '../../common/principal.js';
import { AccessService } from './access.service.js';

const uuid = z.uuid();

/**
 * Multi-tenancy gate. The organization comes ONLY from the `:orgId` route segment — never from a body,
 * query or header — and the caller must belong to it. Everything downstream reads `req.tenant`.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) || this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const orgId = req.params?.orgId;
    if (orgId === undefined) return true; // not an organization route
    const principal = req.principal!;

    // Malformed ids, foreign ids and missing ids all look the same: 404.
    if (typeof orgId !== 'string' || !uuid.safeParse(orgId).success) throw new NotFoundException('Organization not found');

    if (principal.kind === 'apiKey') {
      if (principal.apiKey.organizationId !== orgId) throw new NotFoundException('Organization not found');
      const tenant = await this.access.tenantForApiKey(orgId);
      if (!tenant) throw new NotFoundException('Organization not found');
      req.tenant = tenant;
      return true;
    }

    const tenant = await this.access.tenantFor(req, principal.user.id, orgId);
    if (!tenant) throw new NotFoundException('Organization not found');
    if (!tenant.viaSuperAdmin) {
      const org = await this.access.organizationStatus(orgId);
      if (org !== 'ACTIVE') throw new ForbiddenException('Organization is suspended');
    }
    req.tenant = tenant;
    return true;
  }
}
