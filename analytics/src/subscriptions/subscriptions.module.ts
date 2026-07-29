import { Module } from '@nestjs/common';
import { PubSubService } from './pubsub.service';
import { MetricsSubscription } from './metrics.subscription';

@Module({
  providers: [PubSubService, MetricsSubscription],
  exports: [PubSubService],
})
export class SubscriptionsModule {}
