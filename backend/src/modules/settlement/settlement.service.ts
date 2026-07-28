/**
 *  Settlement service — exposes a unified rate & formatting helpers.
 *  In production this delegates to the wallet-service ledger; here we provide
 *  a self-contained implementation that talks to the same outbox pattern.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { SettlementConfig } from '../../config/settlement.config';
import { RateProvider } from './providers/rate-provider.interface';

export interface RateSnapshot {
  symbol: string;
  usdPerUnit: number;
  source: string;
  fetchedAt: string;
  stale: boolean;
}

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject('RATE_PROVIDERS') private readonly providers: RateProvider[],
  ) {}

  get symbol(): string { return this.config.get<SettlementConfig>('settlement')!.symbol; }
  get name(): string { return this.config.get<SettlementConfig>('settlement')!.name; }
  get decimals(): number { return this.config.get<SettlementConfig>('settlement')!.decimals; }

  async currentRate(): Promise<RateSnapshot> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    for (const p of this.providers) {
      try {
        const v = await p.quote();
        if (v && v > 0) {
          return {
            symbol: cfg.symbol,
            usdPerUnit: v,
            source: p.name,
            fetchedAt: new Date().toISOString(),
            stale: false,
          };
        }
      } catch (e) {
        this.logger.warn(`provider ${p.name} failed: ${(e as Error).message}`);
      }
    }
    // Last resort: return last cached or 0
    const last = await this.redis.get('rial:rate:last');
    return {
      symbol: cfg.symbol,
      usdPerUnit: last ? Number(last) : 0,
      source: 'cache-or-zero',
      fetchedAt: new Date().toISOString(),
      stale: true,
    };
  }

  async convertUsdToRial(usd: number): Promise<bigint> {
    const r = await this.currentRate();
    if (r.usdPerUnit <= 0) throw new Error('No exchange rate available');
    // minor = usd / usdPerUnit * 1e8
    const minor = BigInt(Math.round((usd / r.usdPerUnit) * 1e8));
    return minor;
  }
}
