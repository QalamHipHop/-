import { Controller, Get, HttpCode } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { Public } from '../../common/guards/jwt-auth.guard';

import { DbHealthIndicator } from './indicators/db.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { NatsHealthIndicator } from './indicators/nats.indicator';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DbHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly nats: NatsHealthIndicator,
  ) {}

  @Public()
  @Get('healthz')
  @HttpCode(200)
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Public()
  @Get('readyz')
  @HttpCode(200)
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthy('postgres'),
      () => this.redis.isHealthy('redis'),
      () => this.nats.isHealthy('nats'),
    ]);
  }
}
