/**
 *  Idempotency middleware — caches POST responses by X-Idempotency-Key for 24h.
 *  Required on all state-changing endpoints per architecture §7.
 */
import { Inject, Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

const TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis, private readonly config: ConfigService) {}

  async use(req: FastifyRequest['raw'] & { correlationId?: string }, res: FastifyReply['raw'], next: () => void): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
      return next();
    }
    const key = req.headers['x-idempotency-key'] as string | undefined;
    if (!key) return next();

    if (!/^[a-zA-Z0-9_\-]{8,128}$/.test(key)) {
      throw new HttpException(
        { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be 8-128 chars [a-zA-Z0-9_-]' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const cacheKey = `idem:${this.config.get<string>('app.service', 'rial')}:${req.url}:${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { status: number; body: unknown };
      res.statusCode = parsed.status;
      res.setHeader('X-Idempotent-Replay', 'true');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(parsed.body));
      return;
    }

    // Patch res.end to capture and store
    const originalEnd = res.end.bind(res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).end = (chunk?: unknown, ...args: unknown[]) => {
      try {
        if (res.statusCode < 500) {
          const body = typeof chunk === 'string' ? chunk : chunk ? String(chunk) : '';
          const payload = { status: res.statusCode, body: body || null };
          this.redis.set(cacheKey, JSON.stringify(payload), 'EX', TTL_SECONDS).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
      // @ts-expect-error original end
      return originalEnd(chunk, ...args);
    };

    next();
  }
}
