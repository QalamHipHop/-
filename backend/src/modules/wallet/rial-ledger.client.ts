import { BadGatewayException, Injectable } from '@nestjs/common';

interface RialAccount {
  id: string;
  balance: string;
  available: string;
  pending: string;
  version: string;
  symbol: string;
}

@Injectable()
export class RialLedgerClient {
  private readonly baseUrl = (process.env.WALLET_SERVICE_URL ?? 'http://wallet-service:50052').replace(/\/$/, '');
  private readonly token = process.env.WALLET_INTERNAL_TOKEN ?? '';
  private readonly timeoutMs = Number(process.env.WALLET_TIMEOUT_MS ?? 5_000);

  private async call(path: string, method: string, body?: unknown): Promise<any> {
    if (!this.token) throw new BadGatewayException({ code: 'RIAL_LEDGER_CREDENTIAL_MISSING' });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Rial-Internal-Token': this.token, 'X-Rial-Service': 'backend' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new BadGatewayException({ code: 'RIAL_LEDGER_UNAVAILABLE' });
    }
    const text = await response.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (!response.ok) throw new BadGatewayException({ code: 'RIAL_LEDGER_UPSTREAM_ERROR', status: response.status, body: parsed });
    return parsed;
  }

  async account(userId: string): Promise<{ accountId: string; available: string; pending: string; reserved: string; currency: 'RIAL' }> {
    const a = await this.call(`/v1/accounts/${encodeURIComponent(userId)}`, 'GET') as RialAccount;
    return { accountId: a.id, available: String(a.available ?? 0), pending: String(a.pending ?? 0), reserved: '0', currency: 'RIAL' };
  }

  async transactions(userId: string, limit = 50): Promise<unknown[]> {
    const result = await this.call(`/v1/accounts/${encodeURIComponent(userId)}/transactions?limit=${Math.min(Math.max(limit, 1), 200)}`, 'GET');
    return Array.isArray(result) ? result : (result?.items ?? []);
  }

  async reserve(userId: string, amount: string, reference: string, idempotencyKey: string, metadata?: Record<string, unknown>): Promise<any> {
    return this.call(`/v1/accounts/${encodeURIComponent(userId)}/reserve`, 'POST', { user_id: userId, amount, reference, idempotency_key: idempotencyKey, metadata });
  }

  async release(userId: string, amount: string, reference: string, idempotencyKey: string, metadata?: Record<string, unknown>): Promise<any> {
    return this.call(`/v1/accounts/${encodeURIComponent(userId)}/release`, 'POST', { user_id: userId, amount, reference, idempotency_key: idempotencyKey, metadata });
  }

  async settleTrade(input: { buyerId: string; sellerId: string; notional: string; buyerFee: string; sellerFee: string; reference: string; idempotencyKey: string; metadata?: Record<string, unknown> }): Promise<any> {
    return this.call('/v1/settle-trade', 'POST', {
      buyer_id: input.buyerId, seller_id: input.sellerId, notional: input.notional, buyer_fee: input.buyerFee, seller_fee: input.sellerFee, reference: input.reference, idempotency_key: input.idempotencyKey, metadata: input.metadata,
    });
  }
}
