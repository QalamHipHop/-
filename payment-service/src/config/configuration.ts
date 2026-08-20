// =============================================================================
//  payment-service — Config loader
//  Author: Qalamhiphop
// =============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function tryReadEnvFile(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '..', '.env'),
    join(__dirname, '..', '..', '.env'),
    join(__dirname, '..', '..', '..', '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
      return;
    }
  }
}

tryReadEnvFile();

export interface AppConfig {
  httpPort: number;
  grpcPort: number;
  defaultAdapter: string;
  defaultFiat: string;
  internalToken: string;
  walletBaseUrl?: string;
  walletInternalToken?: string;
  databaseUrl: string;
  corsOrigins: string[];
  logLevel: string;
  limits: {
    minDepositMinor: bigint;
    maxDepositMinor: bigint;
    minWithdrawMinor: bigint;
    maxWithdrawMinor: bigint;
    dailyWithdrawLimitMinor: bigint;
    withdrawalCooldownSeconds: number;
  };
  adapters: Record<
    string,
    {
      enabled: boolean;
      sandbox: boolean;
      [k: string]: unknown;
    }
  >;
}

function bigEnv(name: string, fallback: string): bigint {
  const v = process.env[name];
  if (!v) return BigInt(fallback);
  try {
    return BigInt(v);
  } catch {
    return BigInt(fallback);
  }
}

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export const configuration = (): AppConfig => {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const internalToken = process.env['PAYMENT_INTERNAL_TOKEN'] ?? '';
  if (nodeEnv === 'production' && (internalToken.length < 32 || internalToken === 'change-me')) {
    throw new Error('PAYMENT_INTERNAL_TOKEN must be a unique secret of at least 32 characters in production');
  }
  return {
  httpPort: Number(process.env['PAYMENT_HTTP_PORT'] ?? 50055),
  grpcPort: Number(process.env['PAYMENT_GRPC_PORT'] ?? 50056),
  defaultAdapter: process.env['PAYMENT_DEFAULT_ADAPTER'] ?? 'manual',
  defaultFiat: process.env['PAYMENT_DEFAULT_FIAT'] ?? 'USD',
  internalToken,
  walletBaseUrl: (process.env['PAYMENT_WALLET_BASE_URL'] ?? 'http://wallet-service:50053').replace(/\/$/, ''),
  walletInternalToken: process.env['WALLET_INTERNAL_TOKEN'] ?? '',
  databaseUrl: process.env['PAYMENT_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '',
  corsOrigins: (process.env['PAYMENT_CORS_ORIGINS'] ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  logLevel: process.env['PAYMENT_LOG_LEVEL'] ?? 'info',
  limits: {
    minDepositMinor: bigEnv('PAYMENT_MIN_DEPOSIT_MINOR', '100'),
    maxDepositMinor: bigEnv('PAYMENT_MAX_DEPOSIT_MINOR', '100000000000'),
    minWithdrawMinor: bigEnv('PAYMENT_MIN_WITHDRAW_MINOR', '1000'),
    maxWithdrawMinor: bigEnv('PAYMENT_MAX_WITHDRAW_MINOR', '100000000000'),
    dailyWithdrawLimitMinor: bigEnv('PAYMENT_DAILY_WITHDRAW_LIMIT_MINOR', '50000000000'),
    withdrawalCooldownSeconds: Number(process.env['PAYMENT_WITHDRAWAL_COOLDOWN_SECONDS'] ?? 300),
  },
  adapters: {
    manual: {
      enabled: boolEnv('MANUAL_PAYMENT_ENABLED', true),
      sandbox: false,
      instructions: process.env['MANUAL_PAYMENT_INSTRUCTIONS'] ?? '',
    },
    stripe: {
      enabled: boolEnv('STRIPE_ENABLED', false),
      sandbox: boolEnv('STRIPE_SANDBOX', true),
      apiKey: process.env['STRIPE_API_KEY'] ?? '',
      webhookSecret: process.env['STRIPE_WEBHOOK_SECRET'] ?? '',
    },
    zarinpal: {
      enabled: boolEnv('ZARINPAL_ENABLED', false),
      sandbox: boolEnv('ZARINPAL_SANDBOX', true),
      merchantId: process.env['ZARINPAL_MERCHANT_ID'] ?? '',
      callbackUrl: process.env['ZARINPAL_CALLBACK_URL'] ?? '',
    },
    nowpayments: {
      enabled: boolEnv('NOWPAYMENTS_ENABLED', false),
      sandbox: boolEnv('NOWPAYMENTS_SANDBOX', true),
      apiKey: process.env['NOWPAYMENTS_API_KEY'] ?? '',
      ipnSecret: process.env['NOWPAYMENTS_IPN_SECRET'] ?? '',
    },
  },
  };
};
