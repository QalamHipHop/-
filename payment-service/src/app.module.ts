// =============================================================================
//  payment-service — AppModule
//  Author: Qalamhiphop
// =============================================================================
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { configuration } from './config/configuration';
import { PaymentConfigModule } from './config/payment-config.module';
import { HealthController } from './health/health.controller';
import { AdaptersModule } from './adapters/adapters.module';
import { IntentsModule } from './intents/intents.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { RestController } from './rest/rest.controller';
import { RestModule } from './rest/rest.module';
import { GrpcController } from './grpc/grpc.controller';
import { GrpcModule } from './grpc/grpc.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    LoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env['PAYMENT_LOG_LEVEL'] ?? 'info',
          redact: ['req.headers.authorization', 'req.headers["x-internal-token"]'],
          transport:
            process.env['NODE_ENV'] === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TerminusModule,
    PaymentConfigModule,
    AdaptersModule,
    IntentsModule,
    WebhooksModule,
    RestModule,
    GrpcModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
