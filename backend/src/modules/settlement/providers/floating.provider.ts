/**
 *  FloatingRateProvider — reads a trusted on-chain/internal TWAP written by
 *  the oracle job. It never synthesizes or mutates a market rate itself; an
 *  absent or stale oracle value is unavailable and must fail closed.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { RateProvider } from './rate-provider.interface';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { SettlementConfig } from '../../../config/settlement.config';

const RATE_KEY = 'rial:rate:floating:twap';
const UPDATED_KEY = 'rial:rate:floating:twap:updated_at';

@Injectable()
export class FloatingRateProvider implements RateProvider {
  readonly name = 'floating';
  private readonly logger = new Logger(FloatingRateProvider.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async quote(): Promise<number | null> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    if (cfg.rateStrategy !== 'floating') return null;

    try {
      const [rateRaw, updatedRaw] = await this.redis.mget(RATE_KEY, UPDATED_KEY);
      const rate = Number(rateRaw);
      const updatedAt = Number(updatedRaw);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(updatedAt) || now - updatedAt > cfg.rateStaleAfterSec) {
        this.logger.warn('floating quote unavailable: TWAP is missing or stale');
        return null;
      }
      return rate;
    } catch (e) {
      this.logger.warn(`floating quote failed: ${(e as Error).message}`);
      return null;
    }
  }

  async healthy(): Promise<boolean> {
    return (await this.quote()) !== null;
  }
}
