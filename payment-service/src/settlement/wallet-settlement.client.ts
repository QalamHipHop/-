// Author: QalamHipHop
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';

export type WalletCreditResult = { id?: string; tx_id?: string; transaction_id?: string };

@Injectable()
export class WalletSettlementClient {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async creditDeposit(input: {
    userId: string;
    amountMinor: bigint;
    currency: string;
    reference: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  }): Promise<string> {
    if (!this.cfg.walletInternalToken) {
      throw new Error('WALLET_SETTLEMENT_TOKEN_MISSING');
    }
    const response = await fetch(`${this.cfg.walletBaseUrl}/v1/settle-deposit`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Rial-Internal-Token': this.cfg.walletInternalToken,
        'X-Rial-Service': 'payment',
      },
      body: JSON.stringify({
        user_id: input.userId,
        amount: input.amountMinor.toString(),
        type: 'deposit',
        reference: input.reference,
        idempotency_key: input.idempotencyKey,
        metadata: { ...input.metadata, currency: input.currency, author: 'QalamHipHop' },
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const raw = await response.text();
    let body: WalletCreditResult & { error?: string } = {};
    try {
      body = JSON.parse(raw) as WalletCreditResult & { error?: string };
    } catch {
      // Keep the upstream status as the useful failure signal.
    }
    if (!response.ok) {
      throw new Error(`WALLET_SETTLEMENT_FAILED_${response.status}:${body.error ?? raw.slice(0, 200)}`);
    }
    const id = body.id ?? body.tx_id ?? body.transaction_id;
    if (!id) throw new Error('WALLET_SETTLEMENT_RESPONSE_MISSING_ID');
    return id;
  }
}
