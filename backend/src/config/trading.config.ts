import { registerAs } from '@nestjs/config';

export interface TradingConfig {
  defaultFeeBps: number;
  makerRebateBps: number;
  defaultSlippageBps: number;
  maxMarketsPerUser: number;
  marketMakerEnabled: boolean;
  wsPushIntervalMs: number;
  snapshotIntervalMs: number;
}

export const tradingConfig = registerAs('trading', (): TradingConfig => ({
  defaultFeeBps: Number(process.env.TRADING_DEFAULT_FEE_BPS ?? 30),
  makerRebateBps: Number(process.env.TRADING_MAKER_REBATE_BPS ?? 5),
  defaultSlippageBps: Number(process.env.TRADING_DEFAULT_SLIPPAGE_BPS ?? 50),
  maxMarketsPerUser: Number(process.env.TRADING_MAX_MARKETS_PER_USER ?? 20),
  marketMakerEnabled: process.env.TRADING_MARKET_MAKER === 'true',
  wsPushIntervalMs: Number(process.env.TRADING_WS_PUSH_INTERVAL_MS ?? 250),
  snapshotIntervalMs: Number(process.env.TRADING_SNAPSHOT_INTERVAL_MS ?? 5000),
}));
