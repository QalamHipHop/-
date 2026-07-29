/**
 * Wallet-service integration config.
 * The backend talks to wallet-service (Go) via gRPC for ledger operations.
 */
import { registerAs } from '@nestjs/config';

export interface WalletConfig {
  grpcUrl: string;
  serviceToken: string;
  enabled: boolean;
  timeoutMs: number;
  retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
  /** Names of currencies considered "internal" / free to mint. */
  internalCurrencies: string[];
  /** Default account kinds the wallet creates on demand. */
  defaultAccountKinds: Array<'user' | 'fee' | 'reserve' | 'treasury' | 'reward'>;
  /** Max balance lock TTL in seconds (locks are released if wallet dies). */
  maxLockTtlSec: number;
  /** Withdrawal approval thresholds (minor units) by kyc level. */
  withdrawalLimits: Record<number, bigint>;
}

function limit(kyc: number, defaultMinor: string): bigint {
  const env = process.env[`WALLET_WITHDRAW_LIMIT_KYC${kyc}_MINOR`];
  return BigInt(env ?? defaultMinor);
}

export const walletConfig = registerAs('wallet', (): WalletConfig => ({
  grpcUrl: process.env.WALLET_GRPC_URL ?? 'wallet-service:9090',
  serviceToken: process.env.WALLET_SERVICE_TOKEN ?? 'change-me',
  enabled: process.env.WALLET_ENABLED !== 'false',
  timeoutMs: Number(process.env.WALLET_TIMEOUT_MS ?? 5_000),
  retry: {
    maxAttempts: Number(process.env.WALLET_RETRY_MAX_ATTEMPTS ?? 3),
    baseDelayMs: Number(process.env.WALLET_RETRY_BASE_DELAY_MS ?? 50),
    maxDelayMs: Number(process.env.WALLET_RETRY_MAX_DELAY_MS ?? 1_500),
  },
  internalCurrencies: (process.env.WALLET_INTERNAL_CURRENCIES ?? 'RIAL').split(',').map((s) => s.trim()).filter(Boolean),
  defaultAccountKinds: (process.env.WALLET_DEFAULT_ACCOUNT_KINDS ?? 'user,fee,reserve,treasury,reward')
    .split(',').map((s) => s.trim()).filter(Boolean) as WalletConfig['defaultAccountKinds'],
  maxLockTtlSec: Number(process.env.WALLET_MAX_LOCK_TTL_SEC ?? 86_400),
  withdrawalLimits: {
    0: limit(0, '0'),
    1: limit(1, '500000000000'),         //   5,000 RIAL
    2: limit(2, '5000000000000'),        //  50,000 RIAL
    3: limit(3, '50000000000000'),       // 500,000 RIAL
  },
}));
