// =============================================================================
//  Manual adapter — operator-attested deposits/withdrawals (always available)
//  Author: QalamCode
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  AdapterCancelResult,
  AdapterInfo,
  AdapterIntentResult,
  AdapterVerifyResult,
  CreateIntentInput,
  PaymentAdapter,
} from './adapter.interface';
import { PaymentError } from './types';

@Injectable()
export class ManualAdapter implements PaymentAdapter {
  private readonly log = new Logger(ManualAdapter.name);
  private readonly instructions: string;

  readonly info: AdapterInfo = {
    name: 'manual',
    enabled: true,
    sandbox: false,
    supportedFiats: ['USD', 'EUR', 'IRR', 'IRT'],
    supportedAssets: ['RIAL'],
  };

  constructor(cs: ConfigService) {
    this.instructions = String(cs.get<string>('app.adapters.manual.instructions') ?? '');
  }

  async createIntent(input: CreateIntentInput): Promise<AdapterIntentResult> {
    if (input.kind !== 'deposit' && input.kind !== 'withdrawal') {
      throw new PaymentError('UNSUPPORTED_KIND', 'manual adapter only supports deposit/withdrawal');
    }
    if (input.amount.amountMinor <= 0n) {
      throw new PaymentError('INVALID_AMOUNT', 'amount must be positive');
    }
    const externalId = `manual_${randomUUID()}`;
    this.log.log(
      `manual intent created user=${input.userId} kind=${input.kind} amount=${input.amount.amountMinor} ${input.amount.currency} ref=${externalId}`,
    );
    return {
      externalId,
      status: 'pending',
      redirectUrl: undefined,
      qrCode: undefined,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      rawResponse: { instructions: this.instructions, reference: externalId },
    };
  }

  async verify(externalId: string): Promise<AdapterVerifyResult> {
    return { externalId, status: 'pending', rawResponse: { note: 'manual adapter needs operator verification' } };
  }

  async cancel(externalId: string, reason?: string): Promise<AdapterCancelResult> {
    this.log.log(`manual intent cancelled id=${externalId} reason=${reason ?? 'n/a'}`);
    return { cancelled: true, reason: reason ?? 'manual cancel' };
  }

  verifyWebhookSignature(): boolean {
    // Manual has no remote webhook — internal API only.
    return false;
  }

  async parseWebhook(): Promise<AdapterVerifyResult> {
    throw new PaymentError('UNSUPPORTED', 'manual adapter has no webhook', false);
  }
}
