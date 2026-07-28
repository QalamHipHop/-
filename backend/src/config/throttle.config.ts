import { registerAs } from '@nestjs/config';

export interface ThrottleConfig {
  ttlMs: number;
  limit: number;
}

export const throttleConfig = registerAs('throttle', (): ThrottleConfig => ({
  ttlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
  limit: Number(process.env.THROTTLE_LIMIT ?? 100),
}));
