// =============================================================================
//  Domain types for payment intents (in-memory + future pg-backed store)
//  Author: QalamCode
// =============================================================================
import { Money, MoneyJSON, toJSON } from '../adapters/types';

export type IntentKind = 'deposit' | 'withdrawal';
export type IntentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export interface PaymentIntent {
  id: string;
  kind: IntentKind;
  userId: string;
  adapter: string;
  status: IntentStatus;
  amount: Money;
  settledAmount?: Money;
  reference: string;
  externalId?: string;
  redirectUrl?: string;
  qrCode?: string;
  failureReason?: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  destination?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface IntentJSON {
  id: string;
  kind: IntentKind;
  userId: string;
  adapter: string;
  status: IntentStatus;
  amount: MoneyJSON;
  settledAmount?: MoneyJSON;
  reference: string;
  externalId?: string;
  redirectUrl?: string;
  qrCode?: string;
  failureReason?: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  destination?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export function intentToJSON(i: PaymentIntent): IntentJSON {
  return {
    id: i.id,
    kind: i.kind,
    userId: i.userId,
    adapter: i.adapter,
    status: i.status,
    amount: toJSON(i.amount),
    settledAmount: i.settledAmount ? toJSON(i.settledAmount) : undefined,
    reference: i.reference,
    externalId: i.externalId,
    redirectUrl: i.redirectUrl,
    qrCode: i.qrCode,
    failureReason: i.failureReason,
    idempotencyKey: i.idempotencyKey,
    metadata: i.metadata,
    destination: i.destination,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    expiresAt: i.expiresAt ? i.expiresAt.toISOString() : undefined,
  };
}
