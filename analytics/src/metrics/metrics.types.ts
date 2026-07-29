/**
 * Shared event payload types. Mirror the producer-side events emitted by
 * `trading-engine`, `matching-engine`, `launchpad-service`, and `ai-engine`.
 */

export interface TradeEvent {
  txHash: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: string;       // decimal as string
  amount: string;      // decimal as string
  totalRial: string;   // decimal as string
  maker: string;
  taker: string;
  fee: string;
  ts: number;          // ms
  chain?: 'evm' | 'solana' | 'rial';
}

export interface LaunchEvent {
  symbol: string;
  name: string;
  creator: string;
  totalSupply: string;
  model: 'linear' | 'exponential' | 'logarithmic' | 'sigmoid';
  graduationThreshold: string;
  ts: number;
}

export interface FeeEvent {
  source: 'launchpad' | 'amm' | 'router';
  amount: string;      // in rial
  recipient: string;
  ts: number;
}

export interface AISignalEvent {
  target: string;       // address or symbol
  kind: 'fraud' | 'spam' | 'wash' | 'risk' | 'rugpull';
  score: number;        // 0..1
  evidence?: Record<string, unknown>;
  ts: number;
}
