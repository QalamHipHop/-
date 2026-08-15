import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';

@Injectable()
export class PaymentDatabase implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    if (!cfg.databaseUrl) {
      throw new Error('PAYMENT_DATABASE_URL is required');
    }
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]) {
    return this.pool.query<T>(sql, params as unknown[] | undefined);
  }
}
