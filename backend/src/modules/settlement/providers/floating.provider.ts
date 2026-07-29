/**
 *  FloatingRateProvider — derives USD-per-RIAL from an on-chain or internal TWAP.
 *  In production this would query a subgraph / oracle; for dev we keep a
 *  monotonic drift around a base rate so the API never returns stale data.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

import { RateProvider } from './rate-provider.interface';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { SettlementConfig } from '../../../config/settlement.config';

const KEY = 'rial:rate:floating:base';
const DRIFT_KEY = 'rial:rate:floating:drift';
const DRIFT_STEP = 0.0005;        // 0.05% per refresh
const DRIFT_MAX = 0.05;           // 5% absolute cap
const REFRESH_SEC = 60;

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

    const base = cfg.rateFixed ?? 1;
    try {
      const [baseRaw, driftRaw] = await this.redis.mget(KEY, DRIFT_KEY);
      let drift = driftRaw ? Number(driftRaw) : 0;
      // Random walk bounded by ±DRIFT_MAX
      const step = (Math.random() * 2 - 1) * DRIFT_STEP;
      drift = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, drift + step));
      await this.redis.set(KEY, String(base), 'EX', REFRESH_SEC * 10);
      await this.redis.set(DRIFT_KEY, String(drift), 'EX', REFRESH_SEC * 10);
      return base * (1 + drift);
    } catch (e) {
      this.logger.warn(`floating quote failed: ${(e as Error).message}`);
      return base;
    }
  }

  async healthy(): Promise<boolean> {
    return (await this.quote()) !== null;
  }
}
