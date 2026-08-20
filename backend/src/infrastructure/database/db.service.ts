/**
 *  DbService — the only thing feature modules should use to talk to Postgres.
 *  Provides:
 *    - query<T>(sql, params)
 *    - withTransaction(async (tx) => ...)
 *    - txOutbox(...) helper to write to shared.outbox in same tx as a state change
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { randomUUID, createHash } from 'crypto';

import { PG_POOL } from './database.tokens';

export interface OutboxEvent {
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class DbService {
  private readonly logger = new Logger(DbService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params as unknown[]);
  }

  /** Run callback inside a single transaction; auto-rollback on throw. */
  async withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { this.logger.error('rollback failed', e as Error); }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Write a state change AND an outbox event atomically.
   * Returns the outbox row id.
   */
  async txOutbox(client: PoolClient, ev: OutboxEvent, prevHash: Buffer | null = null): Promise<string> {
    const id = randomUUID();
    const payloadJson = JSON.stringify(ev.payload);
    const payloadHash = createHash('sha256').update(payloadJson).digest();
    await client.query(
      `INSERT INTO shared.outbox (id, aggregate, aggregate_id, event_type, payload, payload_hash, prev_hash, source_service)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'backend')`,
      [id, ev.aggregate, ev.aggregateId, ev.eventType, payloadJson, payloadHash, prevHash],
    );
    return id;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const r = await this.pool.query<{ now: Date }>('SELECT now() AS now');
      return !!r.rows[0]?.now;
    } catch (e) {
      this.logger.error('DB health check failed', e as Error);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
