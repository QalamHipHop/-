import { registerAs } from '@nestjs/config';

export interface NatsConfig {
  servers: string[];
  token: string | null;
  user: string | null;
  pass: string | null;
  stream: string;        // JetStream stream name
  consumerPrefix: string;
}

export const natsConfig = registerAs('nats', (): NatsConfig => ({
  servers: (process.env.NATS_SERVERS ?? 'nats://localhost:4222').split(',').map((s) => s.trim()),
  token: process.env.NATS_TOKEN ?? null,
  user: process.env.NATS_USER ?? null,
  pass: process.env.NATS_PASS ?? null,
  stream: process.env.NATS_STREAM ?? 'rial-events',
  consumerPrefix: process.env.NATS_CONSUMER_PREFIX ?? 'rial-backend',
}));
