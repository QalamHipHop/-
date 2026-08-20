/**
 * Settlement token (RIAL / ﷼) configuration.
 * Per ADR-0003, every monetary value is stored as bigint minor units (8 dp).
 */
import { registerAs } from '@nestjs/config';

export type ExchangeRateStrategy = 'fixed' | 'floating' | 'external';

export interface SettlementConfig {
  symbol: string;        // e.g. "RIAL"
  name: string;          // e.g. "﷼"
  decimals: number;      // minor units, always 8 internally
  rateStrategy: ExchangeRateStrategy;
  rateFixed: string | null;     // USD per 1 RIAL, decimal string
  rateExternalUrl: string | null;
  rateRefreshSec: number;
  rateStaleAfterSec: number;
  // database-stored ledger limits
  minCredit: bigint;     // minor units
  maxCredit: bigint;     // minor units
  reserveAccount: string;
  treasuryAccount: string;
}

export const settlementConfig = registerAs('settlement', (): SettlementConfig => {
  const strategy = (process.env.EXCHANGE_RATE_STRATEGY ?? 'external') as ExchangeRateStrategy;
  if (!['fixed', 'floating', 'external'].includes(strategy)) {
    throw new Error(`Invalid EXCHANGE_RATE_STRATEGY: ${strategy}`);
  }
  return {
    symbol: process.env.SETTLEMENT_TOKEN_SYMBOL ?? 'RIAL',
    name: process.env.SETTLEMENT_TOKEN_NAME ?? '﷼',
    decimals: 8,
    rateStrategy: strategy,
    rateFixed: process.env.EXCHANGE_RATE_FIXED?.trim() || null,
    rateExternalUrl: process.env.EXCHANGE_RATE_EXTERNAL_URL ?? null,
    rateRefreshSec: Number(process.env.EXCHANGE_RATE_REFRESH_SEC ?? 60),
    rateStaleAfterSec: Number(process.env.EXCHANGE_RATE_STALE_AFTER_SEC ?? 300),
    minCredit: BigInt(process.env.MIN_CREDIT_MINOR ?? '10000'),        // 0.0001 RIAL
    maxCredit: BigInt(process.env.MAX_CREDIT_MINOR ?? '1000000000000000000'), // 10^10 RIAL
    reserveAccount: process.env.RESERVE_ACCOUNT ?? 'reserve',
    treasuryAccount: process.env.TREASURY_ACCOUNT ?? 'treasury',
  };
});
