import { Test } from '@nestjs/testing';
import { MetricsService } from '../src/metrics/metrics.service';
import { ClickHouseService } from '../src/clickhouse/clickhouse.service';
import { RedisService } from '../src/redis/redis.service';
import { KafkaService } from '../src/kafka/kafka.service';

describe('AnalyticsService (smoke)', () => {
  it('compiles and instantiates with mocked deps', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: ClickHouseService, useValue: { ping: async () => ({ success: true }), exec: async () => undefined, insert: async () => undefined, query: async () => [] } },
        { provide: RedisService, useValue: { ping: async () => 'PONG', get: async () => null, setex: async () => 'OK', zincrby: async () => '1', zrevrange: async () => [] } },
        { provide: KafkaService, useValue: { subscribe: async () => undefined } },
      ],
    }).compile();
    const svc = moduleRef.get(MetricsService);
    expect(svc).toBeDefined();
  });
});
