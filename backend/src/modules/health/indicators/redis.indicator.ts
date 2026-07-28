import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) { super(); }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    let ok = false;
    try {
      const pong = await this.redis.ping();
      ok = pong === 'PONG';
    } catch { ok = false; }
    const result = this.getStatus(key, ok, { message: 'redis reachable' });
    if (!ok) throw new HealthCheckError('Redis unhealthy', result);
    return result;
  }
}
