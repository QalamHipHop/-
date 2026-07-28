/**
 *  Redis module — single ioredis client shared app-wide, with key prefixing.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { RedisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<Redis> => {
        const cfg = config.get<RedisConfig>('redis')!;
        const client = new Redis({
          host: cfg.host,
          port: cfg.port,
          password: cfg.password ?? undefined,
          db: cfg.db,
          keyPrefix: cfg.keyPrefix,
          tls: cfg.tls ? {} : undefined,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
        // sanity probe
        await client.ping();
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
