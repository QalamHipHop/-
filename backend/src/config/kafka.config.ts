import { registerAs } from '@nestjs/config';

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  ssl: boolean;
  saslMechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512' | null;
  saslUsername: string | null;
  saslPassword: string | null;
  auditTopic: string;
  consumerGroup: string;
}

export const kafkaConfig = registerAs('kafka', (): KafkaConfig => ({
  brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((s) => s.trim()),
  clientId: process.env.KAFKA_CLIENT_ID ?? 'rial-backend',
  ssl: (process.env.KAFKA_SSL ?? 'false') === 'true',
  saslMechanism: (process.env.KAFKA_SASL_MECHANISM as KafkaConfig['saslMechanism']) ?? null,
  saslUsername: process.env.KAFKA_SASL_USERNAME ?? null,
  saslPassword: process.env.KAFKA_SASL_PASSWORD ?? null,
  auditTopic: process.env.KAFKA_AUDIT_TOPIC ?? 'rial.audit',
  consumerGroup: process.env.KAFKA_CONSUMER_GROUP ?? 'rial-backend',
}));
