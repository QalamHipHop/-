/**
 *  Global exception filter — uniform error envelope, never leak stack traces in prod.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId: string;
    timestamp: string;
    path: string;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger = new Logger(GlobalExceptionFilter.name)) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const res = ctx.getResponse<FastifyReply>();

    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      randomUUID();
    const path = req.url ?? 'unknown';
    const timestamp = new Date().toISOString();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
        code = HttpStatus[status] ?? code;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        code = (r.code as string) ?? (r.error as string) ?? HttpStatus[status] ?? code;
        message = (r.message as string) ?? (r.error as string) ?? message;
        details = r.details ?? r.errors;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = exception.name?.replace(/Error$/, '').toUpperCase() || code;
      if (process.env.NODE_ENV !== 'production') {
        details = { stack: exception.stack };
      }
    }

    // log with severity
    if (status >= 500) {
      this.logger.error(`[${correlationId}] ${code} ${status} ${path}: ${message}`, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(`[${correlationId}] ${code} ${status} ${path}: ${message}`);
    }

    const body: ErrorBody = {
      success: false,
      error: { code, message, details, correlationId, timestamp, path },
    };

    res.header('X-Correlation-Id', correlationId);
    res.status(status).send(body);
  }
}
