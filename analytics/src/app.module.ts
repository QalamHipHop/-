import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { join } from 'path';
import { ClickHouseModule } from './clickhouse/clickhouse.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';
import { MetricsModule } from './metrics/metrics.module';
import { ResolversModule } from './resolvers/resolvers.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { HealthController } from './common/health.controller';
import { HealthService } from './common/health.service';
import { loadConfig } from './config/config';

@Module({
  imports: [
    ClickHouseModule,
    RedisModule,
    KafkaModule,
    MetricsModule,
    SubscriptionsModule,
    ResolversModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join('/tmp', 'analytics-schema.gql'),
      sortSchema: true,
      playground: loadConfig().nodeEnv !== 'production',
      subscriptions: {
        'graphql-ws': true,
      },
    }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
