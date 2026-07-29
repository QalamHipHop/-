import pino from 'pino';

const level = process.env.ANALYTICS_LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  base: { svc: 'analytics' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    censor: '[REDACTED]',
  },
});
