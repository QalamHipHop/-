import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';

/**
 * Echo/generate X-Correlation-Id on every request, before guards/pipes.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'] & { correlationId?: string }, res: FastifyReply['raw'], next: () => void): void {
    const incoming =
      (req.headers['x-correlation-id'] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined);
    const id = incoming || randomUUID();
    req.correlationId = id;
    res.setHeader('X-Correlation-Id', id);
    next();
  }
}
