import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Redis } from 'ioredis';

import { RateProvider } from './rate-provider.interface';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';
import { SettlementConfig } from '../../../config/settlement.config';

@Injectable()
export class ExternalRateProvider implements RateProvider {
  readonly name = 'external';
  private readonly logger = new Logger(ExternalRateProvider.name);
  private cacheKey = 'rial:rate:external:usd';

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async quote(): Promise<string | null> {
    const cfg = this.config.get<SettlementConfig>('settlement')!;
    if (cfg.rateStrategy !== 'external' || !cfg.rateExternalUrl) return null;

    const cached = await this.redis.get(this.cacheKey);
    if (cached && isPositiveDecimal(cached)) return cached;

    try {
      const res = await firstValueFrom(this.http.get(cfg.rateExternalUrl, { timeout: 4_000 }));
      const data = res.data as Record<string, unknown>;
      const raw = typeof data === 'object' && data !== null ? data.rate : undefined;
      if (typeof raw !== 'string' || !isPositiveDecimal(raw)) return null;
      await this.redis.set(this.cacheKey, raw, 'EX', cfg.rateRefreshSec);
      return raw;
    } catch (e) {
      this.logger.warn(`External rate fetch failed: ${(e as Error).message}`);
      return null;
    }
  }

  async healthy(): Promise<boolean> {
    return (await this.quote()) !== null;
  }
}

function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim()) && value.trim() !== '0';
}
