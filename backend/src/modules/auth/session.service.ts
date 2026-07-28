/**
 *  Session service — active session ledger in Redis. Tied to refresh-token JTIs.
 *  Devices can be listed and revoked.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

export interface SessionInfo {
  jti: string;
  userId: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeen: string;
  active: boolean;
}

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private indexKey(userId: string): string { return `sessions:${userId}`; }
  private sessionKey(userId: string, jti: string): string { return `session:${userId}:${jti}`; }

  async start(userId: string, ip: string, userAgent: string, ttlSec: number): Promise<string> {
    const jti = randomUUID();
    const now = new Date().toISOString();
    const info: SessionInfo = { jti, userId, ip, userAgent, createdAt: now, lastSeen: now, active: true };
    await this.redis.set(this.sessionKey(userId, jti), JSON.stringify(info), 'EX', ttlSec);
    await this.redis.sadd(this.indexKey(userId), jti);
    await this.redis.expire(this.indexKey(userId), ttlSec);
    return jti;
  }

  async touch(userId: string, jti: string, ttlSec: number): Promise<void> {
    const k = this.sessionKey(userId, jti);
    const raw = await this.redis.get(k);
    if (!raw) return;
    const info = JSON.parse(raw) as SessionInfo;
    info.lastSeen = new Date().toISOString();
    await this.redis.set(k, JSON.stringify(info), 'EX', ttlSec);
  }

  async end(userId: string, jti: string): Promise<void> {
    await this.redis.del(this.sessionKey(userId, jti));
    await this.redis.srem(this.indexKey(userId), jti);
  }

  async list(userId: string): Promise<SessionInfo[]> {
    const ids = await this.redis.smembers(this.indexKey(userId));
    if (ids.length === 0) return [];
    const keys = ids.map((j) => this.sessionKey(userId, j));
    const raws = await this.redis.mget(...keys);
    return raws.filter((s): s is string => Boolean(s)).map((s) => JSON.parse(s) as SessionInfo);
  }
}
