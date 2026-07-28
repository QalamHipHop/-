import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DbService } from '../../../infrastructure/database/db.service';

@Injectable()
export class DbHealthIndicator extends HealthIndicator {
  constructor(private readonly db: DbService) { super(); }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const ok = await this.db.healthCheck();
    const result = this.getStatus(key, ok, { message: 'postgres reachable' });
    if (!ok) throw new HealthCheckError('Postgres unhealthy', result);
    return result;
  }
}
