// =============================================================================
//  payment-service bootstrap
//  - HTTP server (REST + Swagger)
//  - gRPC microservice for internal callers
//  Author: Qalamhiphop
// =============================================================================
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const httpPort = config.get<number>('PAYMENT_HTTP_PORT', 50055);
  const grpcPort = config.get<number>('PAYMENT_GRPC_PORT', 50056);
  const corsOrigins = (config.get<string>('PAYMENT_CORS_ORIGINS', '*') ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // ---- HTTP ---------------------------------------------------------------
  app.enableCors({ origin: corsOrigins.length === 0 ? '*' : corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // ---- Swagger ------------------------------------------------------------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('RIAL Payment Service')
    .setDescription('Pluggable payment adapters — deposits, withdrawals, webhooks')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Internal-Token', in: 'header' }, 'internal')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // ---- gRPC microservice --------------------------------------------------
  const protoPath = join(__dirname, '..', 'proto', 'payment.proto');
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'rial.payment.v1',
      protoPath: [protoPath],
      url: `0.0.0.0:${grpcPort}`,
      loader: {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [join(__dirname, '..', 'proto')],
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(httpPort, '0.0.0.0');

  Logger.log(`payment-service HTTP listening on :${httpPort}`, 'Bootstrap');
  Logger.log(`payment-service gRPC listening on :${grpcPort}`, 'Bootstrap');
  Logger.log(`Swagger UI:           http://localhost:${httpPort}/docs`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal bootstrap error', err);
  process.exit(1);
});
