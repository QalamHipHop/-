/**
 * Rate-limit tiers for @nestjs/throttler.
 * Per ADR-0005 (security) the gateway applies a default tier and tighter tiers
 * on sensitive endpoints (auth, kyc, withdrawal, password reset, mfa).
 */
import { registerAs } from '@nestjs/config';

export interface ThrottleTier {
  name: string;
  ttlMs: number;
  limit: number;
}

export interface ThrottleConfig {
  default: ThrottleTier;
  auth: ThrottleTier;       // login, register, refresh
  kyc: ThrottleTier;        // kyc submit
  withdraw: ThrottleTier;   // withdrawal requests
  mfa: ThrottleTier;        // mfa verify, totp enroll
  passwordReset: ThrottleTier;
  trading: ThrottleTier;    // order placement
  search: ThrottleTier;     // public search
  global: ThrottleTier;     // hard ceiling
}

function tier(name: string, ttlMsEnv: string, limitEnv: string, defaults: { ttl: number; limit: number }): ThrottleTier {
  return {
    name,
    ttlMs: Number(process.env[`THROTTLE_${name.toUpperCase()}_TTL_MS`] ?? defaults.ttl),
    limit: Number(process.env[`THROTTLE_${name.toUpperCase()}_LIMIT`] ?? defaults.limit),
  };
}

export const throttleConfig = registerAs('throttle', (): ThrottleConfig => ({
  default:       tier('default',       'THROTTLE_DEFAULT_TTL_MS',       'THROTTLE_DEFAULT_LIMIT',       { ttl: 60_000, limit: 120 }),
  auth:          tier('auth',          'THROTTLE_AUTH_TTL_MS',          'THROTTLE_AUTH_LIMIT',          { ttl: 60_000, limit: 10  }),
  kyc:           tier('kyc',           'THROTTLE_KYC_TTL_MS',           'THROTTLE_KYC_LIMIT',           { ttl: 3_600_000, limit: 5 }),
  withdraw:      tier('withdraw',      'THROTTLE_WITHDRAW_TTL_MS',      'THROTTLE_WITHDRAW_LIMIT',      { ttl: 3_600_000, limit: 20 }),
  mfa:           tier('mfa',           'THROTTLE_MFA_TTL_MS',           'THROTTLE_MFA_LIMIT',           { ttl: 60_000, limit: 5   }),
  passwordReset: tier('passwordReset', 'THROTTLE_PASSWORD_RESET_TTL_MS','THROTTLE_PASSWORD_RESET_LIMIT',{ ttl: 3_600_000, limit: 3 }),
  trading:       tier('trading',       'THROTTLE_TRADING_TTL_MS',       'THROTTLE_TRADING_LIMIT',       { ttl: 1_000,  limit: 20  }),
  search:        tier('search',        'THROTTLE_SEARCH_TTL_MS',        'THROTTLE_SEARCH_LIMIT',        { ttl: 60_000, limit: 60  }),
  global:        tier('global',        'THROTTLE_GLOBAL_TTL_MS',        'THROTTLE_GLOBAL_LIMIT',        { ttl: 60_000, limit: 600 }),
}));
