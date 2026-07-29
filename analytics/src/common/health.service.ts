import { Injectable } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly ch: ClickHouseService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<{ status: 'ok' | 'degraded'; deps: Record<string, 'ok' | 'fail'> }> {
    const deps: Record<string, 'ok' | 'fail'> = {};
    try {
      await this.ch.ping();
      deps.clickhouse = 'ok';
    } catch {
      deps.clickhouse = 'fail';
    }
    try {
      await this.redis.ping();
      deps.redis = 'ok';
    } catch {
      deps.redis = 'fail';
    }
    const status = Object.values(deps).every((v) => v === 'ok') ? 'ok' : 'degraded';
    return { status, deps };
  }
}
