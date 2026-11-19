import { BadRequestException, type CanActivate, type ExecutionContext, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC, OPTIONAL_AUTH } from '../../common/decorators.js';
import type { AppRequest } from '../../common/principal.js';
import { AuthService } from './auth.service.js';
import { ApiKeyRateLimiter } from './rate-limiter.js';
import { TOKEN_VERIFIER, TokenError, type TokenVerifier } from './token-verifier.js';
import { PlatformTokenService } from '../telegram/platform-token.service.js';

/**
 * Authenticates every non-public request: `Authorization: Bearer <Supabase JWT>` or `X-API-Key`.
 * The resulting principal is the only identity the rest of the pipeline trusts.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly auth: AuthService,
    private readonly limiter: ApiKeyRateLimiter,
    private readonly platformTokens: PlatformTokenService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const apiKey = req.headers['x-api-key'];

    // Optional-auth routes work without credentials; sending any means it must be valid (no silent downgrade).
    if (!bearer && apiKey === undefined && this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, [context.getHandler(), context.getClass()])) return true;

    if (bearer && apiKey) throw new BadRequestException('Send either a bearer token or an API key, not both');

    if (bearer && PlatformTokenService.isPlatformToken(bearer)) {
      // Our own token (Telegram Mini App session), told apart from Supabase tokens by its `kid`.
      const claims = await this.platformTokens.verify(bearer);
      if (!claims) throw new UnauthorizedException('Invalid or expired token');
      const { user, sessionId } = await this.auth.resolvePlatformSession(claims.userId, claims.sessionId);
      req.principal = { kind: 'user', user, sessionId };
      return true;
    }

    if (bearer) {
      let claims;
      try {
        claims = await this.verifier.verify(bearer);
      } catch (error) {
        if (error instanceof TokenError) throw new UnauthorizedException('Invalid or expired token');
        throw error;
      }
      const { user, sessionId } = await this.auth.resolveSupabaseUser(claims);
      req.principal = { kind: 'user', user, sessionId };
      return true;
    }

    if (typeof apiKey === 'string') {
      const { key, user } = await this.auth.resolveApiKey(apiKey);
      try {
        this.limiter.hit(key.id, key.rateLimitPerMinute);
      } catch (error) {
        const retryAfter = (error as { cause?: { retryAfter?: number } }).cause?.retryAfter;
        if (retryAfter) http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
        // Attach the principal first so the over-limit call still lands in the key's request log.
        req.principal = { kind: 'apiKey', apiKey: key, user };
        throw error;
      }
      req.principal = { kind: 'apiKey', apiKey: key, user };
      return true;
    }

    throw new UnauthorizedException('Authentication required');
  }
}
