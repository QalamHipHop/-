/**
 *  Default JWT guard. Mark controllers/handlers with @Public() to bypass.
 *  Mark with @Roles(...) and @RequireScopes(...) to enforce RBAC.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';

import { AuthConfig } from '../../config/auth.config';
import { AuthenticatedUser } from '../../modules/auth/types';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const SCOPES_KEY = 'scopes';
export const RequireScopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    if (ctx.getType<string>() !== 'http' && ctx.getType<string>() !== 'ws') return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthenticatedUser }>();

    // 1) Bearer header
    const auth = req.headers.authorization;
    let token: string | null = null;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      token = auth.slice(7).trim();
    }
    // 2) Cookie fallback
    if (!token) {
      const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
      const cookieName = this.config.get<AuthConfig>('auth')!.session.cookieName;
      token = cookies[cookieName] ?? null;
    }
    // 3) WS handshake auth
    if (!token && (req as unknown as { handshake?: { auth?: { token?: string } } }).handshake?.auth?.token) {
      token = (req as unknown as { handshake: { auth: { token: string } } }).handshake.auth.token;
    }

    if (!token) throw new UnauthorizedException({ code: 'AUTH_MISSING', message: 'Missing access token' });

    const authCfg = this.config.get<AuthConfig>('auth')!;
    let payload: AuthenticatedUser;
    try {
      payload = await this.jwt.verifyAsync<AuthenticatedUser>(token, {
        secret: authCfg.jwt.secret,
        algorithms: [authCfg.jwt.algorithm],
        issuer: authCfg.jwt.issuer,
        audience: authCfg.jwt.audience,
      });
    } catch (e) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID', message: 'Invalid or expired token' });
    }

    // RBAC
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (requiredRoles && requiredRoles.length > 0) {
      const has = (payload.roles ?? []).some((r) => requiredRoles.includes(r));
      if (!has) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE', message: 'Insufficient role' });
    }
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (requiredScopes && requiredScopes.length > 0) {
      const has = (payload.scopes ?? []).some((s) => requiredScopes.includes(s));
      if (!has) throw new ForbiddenException({ code: 'FORBIDDEN_SCOPE', message: 'Insufficient scope' });
    }

    req.user = payload;
    return true;
  }
}
