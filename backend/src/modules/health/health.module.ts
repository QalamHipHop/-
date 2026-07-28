import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DbHealthIndicator } from './indicators/db.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { NatsHealthIndicator } from './indicators/nats.indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DbHealthIndicator, RedisHealthIndicator, NatsHealthIndicator],
})
export class HealthModule {}
