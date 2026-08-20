/**
 *  Wraps every successful controller response in a uniform envelope.
 *  Skips GraphQL and raw responses (already shaped by @nestjs/graphql / @Res).
 */
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map, catchError, throwError } from 'rxjs';
import { FastifyRequest } from 'fastify';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    if (ctx.getType<string>() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();

    // pass-through endpoints (Swagger, GraphQL playground, files)
    if (
      req.url?.startsWith('/docs') ||
      req.url?.startsWith('/graphql') ||
      (req.url?.startsWith('/healthz') || req.url?.startsWith('/v1/healthz')) ||
      (req.url?.startsWith('/readyz') || req.url?.startsWith('/v1/readyz')) ||
      req.url?.startsWith('/metrics')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data: data as T,
        timestamp: new Date().toISOString(),
      })),
      catchError((err) => {
        // Re-throw to be handled by the global exception filter
        return throwError(() => (err instanceof HttpException ? err : new HttpException(String(err?.message ?? err), 500)));
      }),
    );
  }
}
