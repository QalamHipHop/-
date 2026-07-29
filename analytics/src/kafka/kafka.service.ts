import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Kafka, Consumer, EachMessagePayload, logLevel } from 'kafkajs';
import { loadConfig } from '../config/config';
import { logger } from '../common/logger';

type Handler = (payload: EachMessagePayload) => Promise<void>;

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka!: Kafka;
  private consumers: Consumer[] = [];
  private readonly cfg = loadConfig().kafka;

  onModuleInit(): void {
    this.kafka = new Kafka({
      clientId: this.cfg.clientId,
      brokers: this.cfg.brokers,
      logLevel: logLevel.WARN,
    });
    logger.info({ brokers: this.cfg.brokers }, 'kafka client ready');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((c) => c.disconnect().catch(() => undefined)));
  }

  async subscribe(topic: string, groupSuffix: string, handler: Handler): Promise<void> {
    const consumer = this.kafka.consumer({ groupId: `${this.cfg.groupId}-${groupSuffix}` });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async (payload) => {
        try {
          await handler(payload);
        } catch (err) {
          logger.error({ err, topic, partition: payload.partition }, 'kafka handler failed');
        }
      },
    });
    this.consumers.push(consumer);
    logger.info({ topic, groupSuffix }, 'kafka consumer started');
  }
}
