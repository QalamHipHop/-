/**
 *  Database module — owns a single pg.Pool wrapped behind a transaction-aware service.
 *  Never expose raw `pool` to feature modules; go through `DbService`.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

import { DatabaseConfig } from '../../config/database.config';
import { DbService } from './db.service';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<Pool> => {
        const cfg = config.get<DatabaseConfig>('database')!;
        const pool = new Pool({
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          user: cfg.user,
          password: cfg.password,
          min: cfg.poolMin,
          max: cfg.poolMax,
          ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
          statement_timeout: cfg.statementTimeoutMs,
          application_name: 'rial-backend',
        });
        // Sanity probe
        const probe = await pool.query<{ ok: number }>('SELECT 1 AS ok');
        if (probe.rows[0]?.ok !== 1) throw new Error('DB probe failed');
        return pool;
      },
    },
    DbService,
  ],
  exports: [PG_POOL, DbService],
})
export class DatabaseModule {}
