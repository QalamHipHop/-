/**
 *  Kafka module — append-only audit log per ADR-0006 / 0008.
 *  Provides a producer for emitting audit events; consumers are wired per-service.
 */
import { Global, Module, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Kafka, Producer, logLevel } from 'kafkajs';

import { KafkaConfig } from '../../config/kafka.config';

export const KAFKA_CLIENT = 'KAFKA_CLIENT';
export const KAFKA_PRODUCER = 'KAFKA_PRODUCER';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Kafka => {
        const cfg = config.get<KafkaConfig>('kafka')!;
        return new Kafka({
          clientId: cfg.clientId,
          brokers: cfg.brokers,
          ssl: cfg.ssl,
          sasl: cfg.saslMechanism
            ? {
                mechanism: cfg.saslMechanism,
                username: cfg.saslUsername ?? '',
                password: cfg.saslPassword ?? '',
              }
            : undefined,
          logLevel: logLevel.WARN,
        });
      },
    },
    {
      provide: KAFKA_PRODUCER,
      inject: [KAFKA_CLIENT, ConfigService],
      useFactory: async (kafka: Kafka, config: ConfigService): Promise<Producer> => {
        const producer = kafka.producer({
          allowAutoTopicCreation: false,
          idempotent: true,
          maxInFlightRequests: 1,
        });
        await producer.connect();
        return producer;
      },
    },
  ],
  exports: [KAFKA_CLIENT, KAFKA_PRODUCER],
})
export class KafkaModule implements OnApplicationShutdown {
  private readonly logger = new Logger(KafkaModule.name);
  constructor(@Inject(KAFKA_PRODUCER) private readonly producer: Producer) {}
  async onApplicationShutdown(): Promise<void> {
    try { await this.producer.disconnect(); } catch (e) { this.logger.error('kafka disconnect', e as Error); }
  }
}
