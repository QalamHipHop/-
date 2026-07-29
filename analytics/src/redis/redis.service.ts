import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '../config/config';
import { logger } from '../common/logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly url = loadConfig().redis.url;

  onModuleInit(): void {
    this.client = new Redis(this.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (e) => logger.error({ err: e }, 'redis error'));
    this.client.on('connect', () => logger.info('redis connected'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  ping(): Promise<'PONG'> {
    return this.client.ping() as Promise<'PONG'>;
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  setex(key: string, seconds: number, value: string): Promise<'OK'> {
    return this.client.setex(key, seconds, value) as Promise<'OK'>;
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  zincrby(key: string, score: number, member: string): Promise<string> {
    return this.client.zincrby(key, score, member);
  }

  zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }
}
