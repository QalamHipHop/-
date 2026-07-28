/**
 *  TokenService — short-lived access JWTs + long-lived refresh JWTs (rotated).
 *  Refresh tokens are stored in Redis with revocation support.
 */
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

import { AuthConfig } from '../../config/auth.config';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { AuthenticatedUser } from './types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
  tokenType: 'Bearer';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issue(user: { id: string; username?: string; email?: string; roles?: string[]; scopes?: string[]; kyc?: number }): Promise<TokenPair> {
    const cfg = this.config.get<AuthConfig>('auth')!;
    const jti = randomUUID();

    const accessPayload: AuthenticatedUser = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles ?? ['user'],
      scopes: user.scopes ?? [],
      kyc: user.kyc ?? 0,
      jti,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      expiresIn: cfg.jwt.accessTtl,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti, typ: 'refresh' },
      { expiresIn: cfg.jwt.refreshTtl },
    );

    await this.redis.set(this.refreshKey(user.id, jti), '1', 'EX', cfg.jwt.refreshTtl);

    return {
      accessToken,
      refreshToken,
      accessExpiresIn: cfg.jwt.accessTtl,
      refreshExpiresIn: cfg.jwt.refreshTtl,
      tokenType: 'Bearer',
    };
  }

  async rotate(refreshToken: string): Promise<TokenPair> {
    const cfg = this.config.get<AuthConfig>('auth')!;
    let payload: { sub: string; jti: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: cfg.jwt.secret,
        algorithms: [cfg.jwt.algorithm],
        issuer: cfg.jwt.issuer,
        audience: cfg.jwt.audience,
      });
    } catch {
      throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Invalid refresh token' });
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException({ code: 'REFRESH_WRONG_TYPE', message: 'Not a refresh token' });
    }
    const exists = await this.redis.get(this.refreshKey(payload.sub, payload.jti));
    if (!exists) {
      throw new UnauthorizedException({ code: 'REFRESH_REVOKED', message: 'Refresh token revoked' });
    }
    // Revoke old, issue new
    await this.redis.del(this.refreshKey(payload.sub, payload.jti));
    return this.issue({ id: payload.sub });
  }

  async revoke(userId: string, jti: string): Promise<void> {
    await this.redis.del(this.refreshKey(userId, jti));
  }

  async revokeAll(userId: string): Promise<number> {
    const pattern = this.refreshKey(userId, '*');
    const keys = await this.redis.keys(pattern);
    if (keys.length === 0) return 0;
    return this.redis.del(...keys);
  }

  private refreshKey(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }
}
