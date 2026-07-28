import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { NatsConnection } from 'nats';
import { NATS_CONNECTION } from '../../../infrastructure/nats/nats.module';

@Injectable()
export class NatsHealthIndicator extends HealthIndicator {
  constructor(@Inject(NATS_CONNECTION) private readonly nc: NatsConnection) { super(); }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const ok = !this.nc.isClosed();
    const result = this.getStatus(key, ok, { message: 'nats connected' });
    if (!ok) throw new HealthCheckError('NATS unhealthy', result);
    return result;
  }
}
