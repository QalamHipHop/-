/**
 *  Settlement module — owns the internal RIAL unit.
 *  Provides the canonical exchange rate, with a pluggable RateProvider chain.
 *  In production this proxies wallet-service via gRPC; here we expose a local
 *  implementation so the gateway can boot standalone for development.
 */
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SettlementService } from './settlement.service';
import { SettlementController } from './settlement.controller';
import { FixedRateProvider } from './providers/fixed.provider';
import { ExternalRateProvider } from './providers/external.provider';
import { FloatingRateProvider } from './providers/floating.provider';

@Module({
  imports: [HttpModule],
  controllers: [SettlementController],
  providers: [
    FixedRateProvider,
    ExternalRateProvider,
    FloatingRateProvider,
    {
      provide: 'RATE_PROVIDERS',
      useFactory: (fixed: FixedRateProvider, ext: ExternalRateProvider, fl: FloatingRateProvider) => [fixed, fl, ext],
      inject: [FixedRateProvider, ExternalRateProvider, FloatingRateProvider],
    },
    SettlementService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
