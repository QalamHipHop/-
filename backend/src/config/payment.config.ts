import { registerAs } from '@nestjs/config';

export interface PaymentConfig {
  defaultAdapter: string;
  adapters: {
    [adapter: string]: {
      enabled: boolean;
      apiKey?: string;
      apiSecret?: string;
      webhookSecret?: string;
      baseUrl?: string;
      sandbox?: boolean;
      [k: string]: unknown;
    };
  };
  defaultFiat: string;
  minDepositMinor: bigint;
  maxDepositMinor: bigint;
  minWithdrawMinor: bigint;
  maxWithdrawMinor: bigint;
  withdrawalCooldownSeconds: number;
  dailyWithdrawLimitMinor: bigint;
}

function parseAdapterEnv(): PaymentConfig['adapters'] {
  const json = process.env.PAYMENT_ADAPTERS_JSON;
  if (json) {
    try { return JSON.parse(json); } catch { /* fallthrough */ }
  }
  return {
    stripe: {
      enabled: process.env.STRIPE_ENABLED === 'true',
      apiKey: process.env.STRIPE_API_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      sandbox: process.env.STRIPE_SANDBOX !== 'false',
    },
    zarinpal: {
      enabled: process.env.ZARINPAL_ENABLED === 'true',
      merchantId: process.env.ZARINPAL_MERCHANT_ID,
      sandbox: process.env.ZARINPAL_SANDBOX !== 'false',
    },
    nowpayments: {
      enabled: process.env.NOWPAYMENTS_ENABLED === 'true',
      apiKey: process.env.NOWPAYMENTS_API_KEY,
      ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
      sandbox: process.env.NOWPAYMENTS_SANDBOX !== 'false',
    },
    manual: {
      enabled: process.env.MANUAL_PAYMENT_ENABLED !== 'false',
    },
  };
}

export const paymentConfig = registerAs('payment', (): PaymentConfig => ({
  defaultAdapter: process.env.PAYMENT_DEFAULT_ADAPTER ?? 'manual',
  adapters: parseAdapterEnv(),
  defaultFiat: process.env.PAYMENT_DEFAULT_FIAT ?? 'USD',
  minDepositMinor: BigInt(process.env.PAYMENT_MIN_DEPOSIT_MINOR ?? '100'),
  maxDepositMinor: BigInt(process.env.PAYMENT_MAX_DEPOSIT_MINOR ?? '100000000000'),
  minWithdrawMinor: BigInt(process.env.PAYMENT_MIN_WITHDRAW_MINOR ?? '1000'),
  maxWithdrawMinor: BigInt(process.env.PAYMENT_MAX_WITHDRAW_MINOR ?? '50000000000'),
  withdrawalCooldownSeconds: Number(process.env.PAYMENT_WITHDRAWAL_COOLDOWN_S ?? 3600),
  dailyWithdrawLimitMinor: BigInt(process.env.PAYMENT_DAILY_WITHDRAW_LIMIT_MINOR ?? '10000000000'),
}));
