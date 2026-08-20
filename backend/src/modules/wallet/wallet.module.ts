/**
 *  WalletModule — exposes REST /api/wallet + the WalletService for internal use.
 */
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AuthConfig } from '../../config/auth.config';
import { EventsModule } from '../events/events.module';
import { WalletService } from './wallet.service';
import { WalletRepository } from './wallet.repository';
import { WalletController } from './wallet.controller';
import { PaymentClient } from './payment.client';
import { CustodyClient } from './custody.client';
import { RialLedgerClient } from './rial-ledger.client';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule,
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
    EventsModule,
  ],
  controllers: [WalletController],
  providers: [
    WalletService,
    WalletRepository,
    PaymentClient,
    CustodyClient,
    RialLedgerClient,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [WalletService, WalletRepository],
})
export class WalletModule {}
