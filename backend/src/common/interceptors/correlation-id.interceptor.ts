import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';
import { FastifyReply } from 'fastify';

/**
 * Stamps every response with X-Correlation-Id. Reuses incoming header if present.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType<string>() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const res = http.getResponse<FastifyReply>();

    const incoming = (req.headers['x-correlation-id'] as string | undefined) ?? (req.headers['x-request-id'] as string | undefined);
    const id = incoming || randomUUID();
    res.setHeader?.('X-Correlation-Id', id);

    return next.handle().pipe(tap(() => res.setHeader?.('X-Correlation-Id', id)));
  }
}
