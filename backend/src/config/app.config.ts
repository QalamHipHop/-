import { registerAs } from '@nestjs/config';

export interface AppConfig {
  env: 'development' | 'test' | 'staging' | 'production';
  name: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  apiBaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  cors: { origins: string[] };
  shutdownTimeoutMs: number;
  service: string;
  version: string;
}

export const appConfig = registerAs('app', (): AppConfig => ({
  env: (process.env.NODE_ENV as AppConfig['env']) ?? 'development',
  name: process.env.APP_NAME ?? 'RIAL',
  host: process.env.APP_HOST ?? '0.0.0.0',
  port: Number(process.env.APP_PORT ?? 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:8080',
  logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000),
  service: 'rial-backend',
  version: process.env.APP_VERSION ?? '0.1.0',
}));
