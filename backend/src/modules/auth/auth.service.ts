/**
 *  AuthService — orchestrates register/login/refresh/logout/MFA flows.
 *  Idempotency & rate-limit handled at middleware / decorator level.
 */
import { ConflictException, Inject, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { AuthConfig } from '../../config/auth.config';
import { ConfigService } from '@nestjs/config';

import { UserRepository } from './user.repository';
import { PasswordService } from './password.service';
import { TokenService, TokenPair } from './token.service';
import { SessionService } from './session.service';
import { MfaService } from './mfa.service';

export interface RegisterInput {
  email?: string;
  phone?: string;
  username?: string;
  password: string;
}

export interface LoginInput {
  identifier: string;        // email | phone | username
  password: string;
  mfaCode?: string;
  ip: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async register(input: RegisterInput): Promise<TokenPair> {
    if (!input.email && !input.phone && !input.username) {
      throw new BadRequestException({ code: 'AUTH_IDENTIFIER_MISSING', message: 'email, phone, or username is required' });
    }
    if (input.email) {
      const existing = await this.users.findByEmail(input.email);
      if (existing) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'Email already in use' });
    }
    if (input.phone) {
      const existing = await this.users.findByPhone(input.phone);
      if (existing) throw new ConflictException({ code: 'PHONE_TAKEN', message: 'Phone already in use' });
    }
    if (input.username) {
      const existing = await this.users.findByUsername(input.username);
      if (existing) throw new ConflictException({ code: 'USERNAME_TAKEN', message: 'Username already in use' });
    }

    const hash = await this.password.hash(input.password);
    const user = await this.users.createLocal({
      email: input.email,
      phone: input.phone,
      username: input.username,
      passwordHash: hash,
    });
    await this.users.attachIdentity(user.id, 'local', user.id);

    const tokens = await this.tokens.issue({ id: user.id, email: user.email ?? undefined, username: user.username ?? undefined, roles: ['user'] });
    await this.sessions.start(user.id, '0.0.0.0', 'register', this.config.get<AuthConfig>('auth')!.jwt.refreshTtl);
    return tokens;
  }

  async login(input: LoginInput): Promise<TokenPair> {
    const ipKey = `login:fail:ip:${input.ip}`;
    const idKey = `login:fail:user:${input.identifier.toLowerCase()}`;
    const cfg = this.config.get<AuthConfig>('auth')!;
    const ipFails = Number((await this.redis.get(ipKey)) ?? '0');
    const idFails = Number((await this.redis.get(idKey)) ?? '0');
    if (ipFails >= cfg.rateLimit.failedLoginPer15Min || idFails >= cfg.rateLimit.failedLoginPer15Min) {
      throw new UnauthorizedException({ code: 'AUTH_LOCKED', message: 'Too many failed attempts. Try again later.' });
    }

    const user =
      (input.identifier.includes('@') ? await this.users.findByEmail(input.identifier) : null) ??
      (input.identifier.match(/^\+?\d+$/) ? await this.users.findByPhone(input.identifier) : null) ??
      (await this.users.findByUsername(input.identifier));

    if (!user || !user.password_hash) {
      await this.bumpFail(ipKey, idKey);
      throw new UnauthorizedException({ code: 'AUTH_INVALID', message: 'Invalid credentials' });
    }
    if (user.status !== 'active' && user.status !== 'pending') {
      throw new UnauthorizedException({ code: 'AUTH_DISABLED', message: 'Account is not active' });
    }

    const ok = await this.password.verify(input.password, user.password_hash);
    if (!ok) {
      await this.bumpFail(ipKey, idKey);
      throw new UnauthorizedException({ code: 'AUTH_INVALID', message: 'Invalid credentials' });
    }

    // Reset fail counters on success
    await this.redis.del(ipKey, idKey);

    const tokens = await this.tokens.issue({
      id: user.id,
      email: user.email ?? undefined,
      username: user.username ?? undefined,
      roles: ['user'],
      kyc: user.kyc_level,
    });
    await this.sessions.start(user.id, input.ip, input.userAgent, cfg.jwt.refreshTtl);
    return tokens;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  async logout(userId: string, jti?: string): Promise<void> {
    if (jti) {
      await this.tokens.revoke(userId, jti);
      await this.sessions.end(userId, jti);
    } else {
      await this.tokens.revokeAll(userId);
    }
  }

  async me(userId: string) {
    return this.users.findById(userId);
  }

  private async bumpFail(ipKey: string, idKey: string): Promise<void> {
    const ttl = 15 * 60;
    await this.redis.multi().incr(ipKey).expire(ipKey, ttl).incr(idKey).expire(idKey, ttl).exec();
  }
}
