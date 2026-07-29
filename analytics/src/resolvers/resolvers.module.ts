import { Module } from '@nestjs/common';
import { MetricsResolver } from './metrics.resolver';
import { MetricsModule } from '../metrics/metrics.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [MetricsModule, SubscriptionsModule],
  providers: [MetricsResolver],
})
export class ResolversModule {}
