import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { loadConfig } from '../config/config';
import { logger } from '../common/logger';

/**
 * Thin wrapper around the official @clickhouse/client. Provides ping(),
 * a typed insert() helper, and a query() helper. Connection is reused
 * across the lifetime of the service.
 */
@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client!: ClickHouseClient;
  private readonly cfg = loadConfig().clickhouse;

  async onModuleInit(): Promise<void> {
    this.ensureClient();
  }

  private ensureClient(): void {
    if (this.client) return;
    this.client = createClient({
      url: this.cfg.url,
      database: this.cfg.database,
      username: this.cfg.username,
      password: this.cfg.password,
      request_timeout: 30_000,
      max_open_connections: 20,
    });
    logger.info({ url: this.cfg.url, db: this.cfg.database }, 'clickhouse client ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  ping(): Promise<{ success: boolean }> {
    this.ensureClient();
    return this.client.ping();
  }

  async query<T = unknown>(sql: string, params?: Record<string, unknown>): Promise<T[]> {
    this.ensureClient();
    const rs = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return (await rs.json()) as T[];
  }

  async insert<T extends object>(table: string, rows: T[]): Promise<void> {
    this.ensureClient();
    if (rows.length === 0) return;
    await this.client.insert({
      table,
      values: rows,
      format: 'JSONEachRow',
    });
  }

  async exec(sql: string): Promise<void> {
    this.ensureClient();
    await this.client.command({ query: sql });
  }
}
