import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string;            // this service owns this schema
  poolMin: number;
  poolMax: number;
  ssl: boolean;
  statementTimeoutMs: number;
  url: string;
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = Number(process.env.POSTGRES_PORT ?? 5432);
  const database = process.env.POSTGRES_DB ?? 'rial';
  const user = process.env.POSTGRES_USER ?? 'rial';
  const password = process.env.POSTGRES_PASSWORD ?? '';
  const url =
    process.env.DATABASE_URL ??
    `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  return {
    host,
    port,
    database,
    user,
    password,
    schema: process.env.POSTGRES_SCHEMA ?? 'backend',
    poolMin: Number(process.env.POSTGRES_POOL_MIN ?? 5),
    poolMax: Number(process.env.POSTGRES_POOL_MAX ?? 50),
    ssl: (process.env.POSTGRES_SSL ?? 'false') === 'true',
    statementTimeoutMs: Number(process.env.POSTGRES_STMT_TIMEOUT_MS ?? 5000),
    url,
  };
});
