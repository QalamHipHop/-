/**
 *  RIAL — API Gateway entrypoint
 *  Boots NestJS with Fastify, registers all transports (HTTP/REST, GraphQL, WebSocket, microservices).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { IdempotencyMiddleware } from './common/middleware/idempotency.middleware';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { setupGracefulShutdown } from './common/utils/graceful-shutdown';
import { bootstrapTelemetry } from './infrastructure/tracing/telemetry';
import { REDIS_CLIENT } from './infrastructure/redis/redis.module';

async function bootstrap(): Promise<void> {
  // OpenTelemetry must be initialized before any other instrumentation.
  bootstrapTelemetry();

  const adapter = new FastifyAdapter({
    logger: false, // we use pino via nestjs-pino
    bodyLimit: 5 * 1024 * 1024, // 5 MB
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    abortOnError: false,
  });

  const config = app.get(ConfigService);
  const logger = app.get(PinoLogger);
  app.useLogger(logger as any);

  // --- security & global pipes/filters ----------------------------------
  app.enableCors({
    origin: config.get<string[] | string>('cors.origins') ?? ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz', 'metrics', 'graphql'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(logger as any));
  app.useGlobalInterceptors(new ResponseInterceptor());

  // --- middleware (Fastify order matters) -------------------------------
  app.use(new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()));
  const idempotencyMiddleware = new IdempotencyMiddleware(app.get(REDIS_CLIENT), config);
  app.use(idempotencyMiddleware.use.bind(idempotencyMiddleware));

  // --- Swagger / OpenAPI -----------------------------------------------
  if (config.get<string>('app.env') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('RIAL API')
      .setDescription('RIAL — production-grade token launch platform API gateway')
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addApiKey({ type: 'apiKey', name: 'X-Idempotency-Key', in: 'header' }, 'idempotency-key')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // --- graceful shutdown ----------------------------------------------
  setupGracefulShutdown(app);

  // --- start ----------------------------------------------------------
  const port = config.get<number>('app.port', 8080);
  const host = config.get<string>('app.host', '0.0.0.0');
  await app.listen(port, host);
  logger.log(`RIAL API Gateway listening on http://${host}:${port}`);
  logger.log(`GraphQL:  http://${host}:${port}/graphql`);
  logger.log(`REST:     http://${host}:${port}/api/v1/*`);
  logger.log(`WebSocket: ws://${host}:${port}/ws`);
  logger.log(`Health:   http://${host}:${port}/healthz`);
  logger.log(`Settlement token: ${config.get<string>('settlement.symbol', 'RIAL')}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal during bootstrap:', err);
  process.exit(1);
});
