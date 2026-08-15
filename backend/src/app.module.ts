/**
 *  RIAL — Root AppModule
 *  Wires config, infrastructure (db/redis/nats/kafka/tracing), and domain modules.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';

import { appConfig, authConfig, databaseConfig, kafkaConfig, natsConfig, redisConfig, settlementConfig, throttleConfig } from './config';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { NatsModule } from './infrastructure/nats/nats.module';
import { KafkaModule } from './infrastructure/kafka/kafka.module';
import { TracingModule } from './infrastructure/tracing/tracing.module';
import { GraphQLConfigService } from './infrastructure/graphql/graphql-config.service';

import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { EventsModule } from './modules/events/events.module';
import { TradingModule } from './modules/trading/trading.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { LaunchpadModule } from './modules/launchpad/launchpad.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    // ---------- Config & logging ----------
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, authConfig, databaseConfig, kafkaConfig, natsConfig, redisConfig, settlementConfig, throttleConfig],
      validationSchema: undefined, // validated inside config factories for type-safety
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('app.logLevel', 'info'),
          transport:
            config.get<string>('app.env') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
          redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.secret'],
          autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
          customProps: () => ({ service: 'rial-backend', env: config.get('app.env') }),
        },
      }),
    }),

    // ---------- Rate limiting ----------
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { ttl: config.get<number>('throttle.ttlMs', 60_000), limit: config.get<number>('throttle.limit', 100) },
      ],
    }),

    // ---------- Infrastructure ----------
    DatabaseModule,
    RedisModule,
    NatsModule,
    KafkaModule,
    TracingModule,

    // ---------- GraphQL Federation ----------
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [],
      inject: [ConfigService],
      useClass: GraphQLConfigService,
    }),

    // ---------- Domain modules ----------
    TerminusModule,
    HealthModule,
    AuthModule,
    UsersModule,
    SettlementModule,
    EventsModule,
    TradingModule,
    WalletModule,
    LaunchpadModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: CorrelationIdInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
