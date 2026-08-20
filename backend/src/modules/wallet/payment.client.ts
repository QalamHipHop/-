import { BadGatewayException, Injectable } from '@nestjs/common';

@Injectable()
export class PaymentClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = (process.env.PAYMENT_SERVICE_URL ?? 'http://payment-service:50051').replace(/\/$/, '');
    this.token = process.env.PAYMENT_INTERNAL_TOKEN ?? '';
    if (process.env.NODE_ENV === 'production' && !this.token) {
      throw new Error('PAYMENT_INTERNAL_TOKEN is required in production');
    }
  }

  async createDeposit(input: {
    userId: string;
    adapter: string;
    amount: { amountMinor: string; currency: string };
    reference: string;
    idempotencyKey: string;
    returnUrl?: string;
    metadata?: Record<string, string>;
  }): Promise<unknown> {
    if (!this.token) throw new BadGatewayException({ code: 'PAYMENT_CREDENTIAL_MISSING' });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/deposits`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Internal-Token': this.token, 'X-Rial-Service': 'backend' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new BadGatewayException({ code: 'PAYMENT_UNAVAILABLE' });
    }
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    if (!response.ok) throw new BadGatewayException({ code: 'PAYMENT_UPSTREAM_ERROR', status: response.status, body });
    return body;
  }
}
