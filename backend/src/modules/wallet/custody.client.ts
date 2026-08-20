import { BadGatewayException, Injectable } from '@nestjs/common';

@Injectable()
export class CustodyClient {
  private readonly baseUrl = (process.env.WALLET_SERVICE_URL ?? 'http://wallet-service:50052').replace(/\/$/, '');
  private readonly token = process.env.WALLET_INTERNAL_TOKEN ?? '';

  private async call(path: string, method: string, body?: unknown): Promise<unknown> {
    if (!this.token) throw new BadGatewayException({ code: 'CUSTODY_CREDENTIAL_MISSING' });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Rial-Internal-Token': this.token, 'X-Rial-Service': 'backend' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000) });
    } catch { throw new BadGatewayException({ code: 'CUSTODY_UNAVAILABLE' }); }
    const text = await response.text();
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (!response.ok) throw new BadGatewayException({ code: 'CUSTODY_UPSTREAM_ERROR', status: response.status, body: parsed });
    return parsed;
  }

  async listWithdrawalDestinations(userId: string): Promise<unknown> {
    return this.call(`/v1/accounts/${encodeURIComponent(userId)}/withdrawal-destinations`, 'GET');
  }

  async createWithdrawalDestination(input: { userId: string; chain: 'evm' | 'solana' | 'btc' | 'iban'; destination: string; label?: string }): Promise<unknown> {
    return this.call('/v1/withdrawal-destinations', 'POST', input);
  }

  async confirmWithdrawalDestination(input: { userId: string; id: string; token: string }): Promise<unknown> {
    return this.call(`/v1/withdrawal-destinations/${encodeURIComponent(input.id)}/confirm`, 'POST', { user_id: input.userId, token: input.token });
  }

  async revokeWithdrawalDestination(input: { userId: string; id: string }): Promise<unknown> {
    return this.call(`/v1/withdrawal-destinations/${encodeURIComponent(input.id)}?user_id=${encodeURIComponent(input.userId)}`, 'DELETE');
  }

  async requestWithdrawal(input: { userId: string; amount: string; chain: 'evm' | 'solana' | 'btc' | 'iban'; destination: string; idempotencyKey: string }): Promise<unknown> {
    return this.call('/v1/withdraw', 'POST', input);
  }
}
