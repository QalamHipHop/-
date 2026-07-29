// =============================================================================
//  PaymentAdapter — common contract for all providers
//  Author: QalamCode
// =============================================================================
import { Money, PaymentKind } from './types';

export interface CreateIntentInput {
  userId: string;
  kind: PaymentKind;
  amount: Money;
  reference: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  returnUrl?: string;
  destination?: string;
}

export interface AdapterIntentResult {
  externalId: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  redirectUrl?: string;
  qrCode?: string;
  expiresAt?: Date;
  rawResponse?: Record<string, unknown>;
}

export interface AdapterVerifyResult {
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  externalId: string;
  settledAmount?: Money;
  failureReason?: string;
  rawResponse?: Record<string, unknown>;
}

export interface AdapterCancelResult {
  cancelled: boolean;
  reason?: string;
}

export interface AdapterInfo {
  name: string;
  enabled: boolean;
  sandbox: boolean;
  supportedFiats: string[];
  supportedAssets: string[];
}

export interface PaymentAdapter {
  readonly info: AdapterInfo;
  createIntent(input: CreateIntentInput): Promise<AdapterIntentResult>;
  verify(externalId: string): Promise<AdapterVerifyResult>;
  cancel(externalId: string, reason?: string): Promise<AdapterCancelResult>;
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>, signature: string): boolean;
  parseWebhook(rawBody: Buffer, headers: Record<string, string>, signature: string): Promise<AdapterVerifyResult>;
}
