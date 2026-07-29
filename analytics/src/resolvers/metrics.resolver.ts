import { Resolver, Query, Args, Int, ObjectType, Field } from '@nestjs/graphql';
import { MetricsService } from '../metrics/metrics.service';
import { PubSubService } from '../subscriptions/pubsub.service';

@ObjectType()
class TopMover {
  @Field() symbol!: string;
  @Field() changePct!: number;
}

@ObjectType()
class TrendingToken {
  @Field() symbol!: string;
  @Field() score!: number;
}

@ObjectType()
class PlatformStats {
  @Field() tvlRial!: string;
  @Field() volume24h!: string;
  @Field(() => Int) trades24h!: number;
  @Field(() => Int) tokens!: number;
}

@Resolver()
export class MetricsResolver {
  constructor(
    private readonly metrics: MetricsService,
    private readonly pubsub: PubSubService,
  ) {}

  @Query(() => [TopMover])
  async topMovers(
    @Args('limit', { type: () => Int, defaultValue: 10 }) limit: number,
    @Args('windowMin', { type: () => Int, defaultValue: 5 }) windowMin: number,
  ): Promise<TopMover[]> {
    return this.metrics.topMovers(limit, windowMin);
  }

  @Query(() => [TrendingToken])
  async trending(
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
  ): Promise<TrendingToken[]> {
    return this.metrics.trending(limit);
  }

  @Query(() => PlatformStats)
  async platformStats(): Promise<PlatformStats> {
    return this.metrics.platformStats();
  }
}
