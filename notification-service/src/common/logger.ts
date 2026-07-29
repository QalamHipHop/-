import pino from 'pino';

export const logger = pino({
  name: 'notification-service',
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'notification-service' },
});

export type Logger = typeof logger;
