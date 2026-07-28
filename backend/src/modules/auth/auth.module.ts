import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthConfig } from '../../config/auth.config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthResolver } from './auth.resolver';
import { TokenService } from './token.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { UserRepository } from './user.repository';
import { MfaService } from './mfa.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.get<AuthConfig>('auth')!;
        return {
          secret: cfg.jwt.secret,
          signOptions: { algorithm: cfg.jwt.algorithm, issuer: cfg.jwt.issuer, audience: cfg.jwt.audience },
          verifyOptions: { algorithms: [cfg.jwt.algorithm], issuer: cfg.jwt.issuer, audience: cfg.jwt.audience },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthResolver, TokenService, PasswordService, SessionService, UserRepository, MfaService],
  exports: [AuthService, TokenService, UserRepository],
})
export class AuthModule {}
