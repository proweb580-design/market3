import { BadGatewayException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentPrincipal, Public, Req, UserOnly } from '../../common/decorators.js';
import type { AppRequest, Principal } from '../../common/principal.js';
import { ApiZodBody, ZodPipe } from '../../common/zod.js';
import { ENV, type Env } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';

export const ownerLoginSchema = z.strictObject({ login: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });
const WRONG = 'Wrong login or password';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Dashboard sign-in by short login: OWNER_LOGIN stands for the email of the oldest store's owner, so the email never
   * reaches the browser. The password is checked by Supabase; the answer is that user's own Supabase session.
   * shortcut: every attempt reaches Supabase from this server's IP, so Supabase's per-IP limit is shared — email sign-in still works if it trips.
   */
  @Post('owner-login')
  @HttpCode(200)
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiZodBody(ownerLoginSchema)
  async ownerLogin(@Body(new ZodPipe(ownerLoginSchema)) body: z.infer<typeof ownerLoginSchema>) {
    if (body.login.toLowerCase() !== this.env.OWNER_LOGIN.toLowerCase()) throw new UnauthorizedException(WRONG);
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!this.env.SUPABASE_URL || !key) throw new ServiceUnavailableException('Short login is not configured — sign in with your email');
    const owner = await this.db.organizationMember.findFirst({
      where: { status: 'ACTIVE', role: { key: 'ORG_OWNER' }, organization: { status: 'ACTIVE', deletedAt: null }, user: { email: { not: null } } },
      orderBy: { organization: { createdAt: 'asc' } },
      select: { user: { select: { email: true } } },
    });
    if (!owner?.user.email) throw new UnauthorizedException(WRONG);

    const res = await fetch(`${this.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: owner.user.email, password: body.password }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (res?.status === 400) throw new UnauthorizedException(WRONG);
    if (res?.status === 429) throw new HttpException('Too many attempts — wait a few minutes', HttpStatus.TOO_MANY_REQUESTS);
    const session = res?.ok ? ((await res.json()) as { access_token?: string; refresh_token?: string }) : null;
    if (!session?.access_token || !session.refresh_token) throw new BadGatewayException('Sign-in service is unavailable');
    return { accessToken: session.access_token, refreshToken: session.refresh_token };
  }

  /** Who am I: account, platform roles/permissions and organization memberships. The frontend's single bootstrap call. */
  @Get('me')
  @UserOnly()
  @ApiOkResponse({ description: 'Current user with roles, permissions and organizations' })
  async me(@Req() req: AppRequest, @CurrentPrincipal() principal: Principal) {
    if (principal.kind !== 'user') throw new Error('unreachable: @UserOnly');
    const [user, platform, memberships] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: principal.user.id },
        select: { id: true, email: true, status: true, createdAt: true, profile: true, settings: true, telegramAccount: { select: { username: true, linkedAt: true } } },
      }),
      this.access.platformAccess(req, principal.user.id),
      this.db.organizationMember.findMany({
        where: { userId: principal.user.id, status: 'ACTIVE', organization: { deletedAt: null } },
        select: { organization: { select: { id: true, slug: true, name: true, status: true } }, role: { select: { key: true, name: true } } },
      }),
    ]);
    return {
      ...user,
      platformRoles: platform.roleKeys,
      platformPermissions: [...platform.permissions].sort(),
      isSuperAdmin: platform.isSuperAdmin,
      organizations: memberships.map((m) => ({ ...m.organization, role: m.role })),
    };
  }

  /** Signs this device out on our side. The Supabase session is ended by the frontend (`supabase.auth.signOut()`). */
  @Post('logout')
  @HttpCode(204)
  @UserOnly()
  async logout(@Req() req: AppRequest, @CurrentPrincipal() principal: Principal) {
    if (principal.kind !== 'user' || !principal.sessionId) return;
    await this.db.session.updateMany({ where: { id: principal.sessionId, userId: principal.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record(req, { action: 'auth.logout', entityType: 'session', entityId: principal.sessionId });
  }
}
