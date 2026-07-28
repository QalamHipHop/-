import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  password: string | null;
  db: number;
  keyPrefix: string;
  tls: boolean;
}

export const redisConfig = registerAs('redis', (): RedisConfig => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? null,
  db: Number(process.env.REDIS_DB ?? 0),
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'rial:',
  tls: (process.env.REDIS_TLS ?? 'false') === 'true',
}));
