import { Injectable } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

/**
 * Lightweight in-process pub/sub for GraphQL subscriptions. For horizontal
 * scaling, swap to graphql-redis-subscriptions pointing at the same Redis
 * the platform already runs.
 */
@Injectable()
export class PubSubService {
  private readonly pubsub = new PubSub();

  async publish<T>(trigger: string, payload: T): Promise<void> {
    await this.pubsub.publish(trigger, payload);
  }

  asyncIterator<T = unknown>(triggers: string | string[]): AsyncIterator<T> {
    return this.pubsub.asyncIterableIterator<T>(triggers) as unknown as AsyncIterator<T>;
  }
}
