/**
 *  Auth REST controller — /api/v1/auth/*
 *  All public routes are explicitly marked @Public().
 */
import {
  Body, Controller, Get, HttpCode, Post, Req, UseGuards, Headers, BadRequestException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { IsEmail, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

import { AuthService } from './auth.service';
import { Public } from '../../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from './types';
import { TokenPair } from './token.service';

class RegisterDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(/^\+?\d{6,16}$/) phone?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(32) username?: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
}
class LoginDto {
  @IsString() @MinLength(3) @MaxLength(255) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @Matches(/^\d{6}$/) mfaCode?: string;
}
class RefreshDto {
  @IsString() @MinLength(20) refreshToken!: string;
}
class ChangePasswordDto {
  @IsString() @MinLength(10) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
}

interface AuthedRequest extends FastifyRequest {
  user?: AuthenticatedUser;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto): Promise<TokenPair> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AuthedRequest): Promise<TokenPair> {
    const ip = (req.ip || req.socket.remoteAddress || '0.0.0.0').toString();
    const ua = (req.headers['user-agent'] as string) ?? 'unknown';
    return this.auth.login({ ...dto, ip, userAgent: ua });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto): Promise<TokenPair> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Headers('authorization') _auth?: string): Promise<void> {
    const u = req.user;
    if (!u) throw new BadRequestException({ code: 'AUTH_REQUIRED', message: 'Login required' });
    await this.auth.logout(u.sub, u.jti);
  }

  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const u = req.user!;
    const user = await this.auth.me(u.sub);
    if (!user) return null;
    const { password_hash, ...safe } = user;
    return safe;
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest): Promise<void> {
    const u = req.user!;
    await this.auth.logout(u.sub, u.jti);
    return; // password change pipeline continues here
  }
}
