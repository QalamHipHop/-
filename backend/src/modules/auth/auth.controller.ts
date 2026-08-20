/**
 * Auth REST controller — /api/v1/auth/*
 * All public routes are explicitly marked @Public().
 */
import {
  Body, Controller, Get, HttpCode, Post, Req, Res, Headers, BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

import { AuthService } from './auth.service';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from './types';
import { TokenPair } from './token.service';
import { AuthConfig } from '../../config/auth.config';
import { MfaService } from './mfa.service';

class RegisterDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(/^\+?\d{6,16}$/) phone?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(32) username?: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}
class LoginDto {
  @IsString() @MinLength(3) @MaxLength(255) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @Matches(/^(?:\d{6}|[A-Fa-f0-9]{16})$/) mfaCode?: string;
}
class RefreshDto {
  @IsOptional() @IsString() @MinLength(20) refreshToken?: string;
}
class MfaConfirmDto {
  @IsString() @Matches(/^\d{6}$/) token!: string;
}
class ChangePasswordDto {
  @IsString() @MinLength(10) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
}

interface AuthedRequest extends FastifyRequest {
  user?: AuthenticatedUser;
}

type PublicTokenPair = Omit<TokenPair, 'refreshToken'>;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService, private readonly mfa: MfaService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) reply: FastifyReply): Promise<PublicTokenPair> {
    const pair = await this.auth.register(dto);
    this.setSessionCookies(reply, pair);
    return this.publicPair(pair);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<PublicTokenPair> {
    const ip = (req.ip || req.socket.remoteAddress || '0.0.0.0').toString();
    const ua = (req.headers['user-agent'] as string) ?? 'unknown';
    const pair = await this.auth.login({ ...dto, ip, userAgent: ua });
    this.setSessionCookies(reply, pair);
    return this.publicPair(pair);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<PublicTokenPair> {
    const auth = this.config.get<AuthConfig>('auth')!;
    const refreshToken = dto.refreshToken ?? req.cookies?.[auth.session.refreshCookieName];
    if (!refreshToken) throw new BadRequestException({ code: 'REFRESH_REQUIRED', message: 'Refresh token required' });
    const pair = await this.auth.refresh(refreshToken);
    this.setSessionCookies(reply, pair);
    return this.publicPair(pair);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) reply: FastifyReply, @Headers('authorization') _auth?: string): Promise<void> {
    const u = req.user;
    if (!u) throw new BadRequestException({ code: 'AUTH_REQUIRED', message: 'Login required' });
    await this.auth.logout(u.sub, u.jti);
    this.clearSessionCookies(reply);
  }

  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const u = req.user!;
    const user = await this.auth.me(u.sub);
    if (!user) return null;
    const { password_hash: _passwordHash, ...safe } = user;
    return safe;
  }

  @Post('mfa/enroll')
  async beginMfaEnrollment(@Req() req: AuthedRequest): Promise<{ otpauthUrl: string; recoveryCodes: string[] }> {
    const u = req.user!;
    return this.mfa.beginEnrollment(u.sub, u.email ?? u.username ?? u.sub);
  }

  @Post('mfa/confirm')
  @HttpCode(204)
  async confirmMfaEnrollment(@Body() dto: MfaConfirmDto, @Req() req: AuthedRequest): Promise<void> {
    await this.mfa.confirmEnrollment(req.user!.sub, dto.token);
  }

  @Post('mfa/revoke')
  @HttpCode(204)
  async revokeMfaEnrollment(@Req() req: AuthedRequest): Promise<void> {
    await this.mfa.revokeEnrollment(req.user!.sub);
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest): Promise<void> {
    const u = req.user!;
    await this.auth.changePassword(u.sub, dto.currentPassword, dto.newPassword);
  }

  private publicPair(pair: TokenPair): PublicTokenPair {
    const { refreshToken: _refreshToken, ...publicPair } = pair;
    return publicPair;
  }

  private setSessionCookies(reply: FastifyReply, pair: TokenPair): void {
    const auth = this.config.get<AuthConfig>('auth')!;
    const common = {
      httpOnly: true,
      secure: auth.session.cookieSecure,
      sameSite: auth.session.cookieSameSite,
    } as const;
    reply.setCookie(auth.session.cookieName, pair.accessToken, { ...common, path: '/', maxAge: pair.accessExpiresIn });
    reply.setCookie(auth.session.refreshCookieName, pair.refreshToken, { ...common, path: '/api/v1/auth', maxAge: pair.refreshExpiresIn });
  }

  private clearSessionCookies(reply: FastifyReply): void {
    const auth = this.config.get<AuthConfig>('auth')!;
    reply.clearCookie(auth.session.cookieName, { path: '/' });
    reply.clearCookie(auth.session.refreshCookieName, { path: '/api/v1/auth' });
  }
}
