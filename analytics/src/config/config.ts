/**
 * Centralised, type-safe configuration loader. Reads from process.env with
 * sensible defaults for local dev. Throws on missing required production vars.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
  };
  redis: { url: string };
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topics: {
      trades: string;
      launches: string;
      fees: string;
      aiSignals: string;
    };
  };
  nats: { url: string };
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`);
    }
    return '';
  }
  return v;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
    port: parseInt(process.env.ANALYTICS_PORT ?? '3010', 10),
    logLevel: process.env.ANALYTICS_LOG_LEVEL ?? 'info',
    clickhouse: {
      url: required('CLICKHOUSE_URL', 'http://localhost:8123'),
      database: required('CLICKHOUSE_DB', 'rial_analytics'),
      username: required('CLICKHOUSE_USER', 'rial'),
      password: required('CLICKHOUSE_PASSWORD', 'change-me'),
    },
    redis: { url: required('REDIS_URL', 'redis://localhost:6379') },
    kafka: {
      brokers: required('KAFKA_BROKERS', 'localhost:9092').split(',').map((s) => s.trim()),
      clientId: required('KAFKA_CLIENT_ID', 'rial-analytics'),
      groupId: required('KAFKA_GROUP_ID', 'rial-analytics-consumers'),
      topics: {
        trades: required('KAFKA_TOPIC_TRADES', 'rial.trades.v1'),
        launches: required('KAFKA_TOPIC_LAUNCHES', 'rial.launches.v1'),
        fees: required('KAFKA_TOPIC_FEES', 'rial.fees.v1'),
        aiSignals: required('KAFKA_TOPIC_AI_SIGNALS', 'rial.ai.signals.v1'),
      },
    },
    nats: { url: required('NATS_URL', 'nats://localhost:4222') },
  };
}
