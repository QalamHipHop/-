import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AuthConfig } from '../../config/auth.config';
import { EventsModule } from '../events/events.module';
import { WalletModule } from '../wallet/wallet.module';
import { TradingService } from './trading.service';
import { TradingRepository } from './trading.repository';
import { TradingController } from './trading.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TradeSettlementRecoveryWorker } from './trade-settlement-recovery.worker';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.get<AuthConfig>('auth')!;
        return { secret: cfg.jwt.secret, signOptions: { algorithm: cfg.jwt.algorithm, issuer: cfg.jwt.issuer, audience: cfg.jwt.audience } };
      },
    }),
    EventsModule,
    WalletModule,
  ],
  controllers: [TradingController],
  providers: [TradingService, TradingRepository, TradeSettlementRecoveryWorker, { provide: APP_GUARD, useClass: RolesGuard }],
  exports: [TradingService, TradingRepository],
})
export class TradingModule {}
