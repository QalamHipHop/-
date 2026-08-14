/**
 *  Shared types for the wallet module.
 *  All amounts are passed as strings (decimal) to avoid JS number precision loss.
 *  The wallet service itself uses bigint with 8-decimal minor units internally.
 */
import type { UserPublic } from '../auth/types';

export type Currency = 'RIAL' | string;

export type AccountType = 'user' | 'hot' | 'cold' | 'treasury' | 'fee' | 'reward';

export interface Account {
  id: string;
  owner_type: 'user' | 'service';
  owner_id: string;
  account_type: AccountType;
  currency: Currency;
  address: string | null;
  label: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Balance {
  account_id: string;
  available_minor: string;
  pending_minor: string;
  reserved_minor: string;
  updated_at: Date;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'deposit' | 'withdraw' | 'trade' | 'launch' | 'fee' | 'reward' | 'transfer';
  currency: Currency;
  amount_minor: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  meta: Record<string, unknown>;
  created_at: Date;
}

export interface TransferInput {
  userId: string;
  toUserId?: string;
  currency: Currency;
  amountMinor: string;
  reason: string;
  meta?: Record<string, unknown>;
  clientId?: string;
}

export interface TransferResult {
  txId: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: string;
  newFromBalance: string;
  newToBalance: string;
}

export interface LockInput {
  userId: string;
  currency: Currency;
  amountMinor: string;
  reason: string;
  refId?: string;
  ttlSeconds?: number;
}

export interface UnlockInput {
  userId: string;
  currency: Currency;
  amountMinor: string;
  reason: string;
  refId?: string;
}

export interface MultiSigProposal {
  id: string;
  chain: string;
  to_address: string;
  amount_minor: string;
  currency: Currency;
  data: Buffer | null;
  threshold: number;
  status: 'pending' | 'signed' | 'broadcast' | 'confirmed' | 'failed' | 'cancelled';
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
}

export interface WalletSummary {
  user: Pick<UserPublic, 'id' | 'username' | 'email'>;
  accounts: Array<Account & Balance & { total_minor: string }>;
}
