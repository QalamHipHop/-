import { Resolver, Subscription, ObjectType, Field, Args } from '@nestjs/graphql';
import { PubSubService } from './pubsub.service';

@ObjectType()
class TradeTick {
  @Field() symbol!: string;
  @Field() price!: string;
  @Field() amount!: string;
  @Field() ts!: number;
}

@Resolver()
export class MetricsSubscription {
  constructor(private readonly pubsub: PubSubService) {}

  @Subscription(() => TradeTick, {
    name: 'tradeFeed',
    filter: (payload: { tradeFeed: TradeTick; variables: { symbol: string } }) =>
      payload.tradeFeed.symbol === payload.variables.symbol,
  })
  tradeFeed(@Args('symbol') _symbol: string): AsyncIterator<TradeTick> {
    return this.pubsub.asyncIterator<TradeTick>('TRADE_FEED');
  }
}
