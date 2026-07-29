// =============================================================================
//  Global HTTP exception filter — uniform error envelope
//  Author: QalamCode
// =============================================================================
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    path: string;
    timestamp: string;
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const p = payload as Record<string, unknown>;
        message = (p['message'] as string) ?? exception.message;
        code = (p['error'] as string) ?? HttpStatus[status] ?? 'ERROR';
        details = p['details'];
      }
      if (status === HttpStatus.BAD_REQUEST) code = code === 'INTERNAL_ERROR' ? 'BAD_REQUEST' : code;
      if (status === HttpStatus.NOT_FOUND) code = code === 'INTERNAL_ERROR' ? 'NOT_FOUND' : code;
      if (status === HttpStatus.CONFLICT) code = code === 'INTERNAL_ERROR' ? 'CONFLICT' : code;
      if (status === HttpStatus.UNPROCESSABLE_ENTITY)
        code = code === 'INTERNAL_ERROR' ? 'VALIDATION_ERROR' : code;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = exception.message;
    }

    const envelope: ErrorEnvelope = {
      ok: false,
      error: {
        code,
        message,
        details,
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      },
    };

    res.status(status).json(envelope);
  }
}
