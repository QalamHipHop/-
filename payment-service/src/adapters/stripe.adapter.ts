// =============================================================================
//  Stripe adapter — PaymentIntents + webhooks (HMAC-SHA256 signed)
//  Author: QalamCode
//  Note: uses raw https calls (no Stripe SDK) to keep deps minimal and
//        support offline test mode via sandbox flag.
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import {
  AdapterCancelResult,
  AdapterInfo,
  AdapterIntentResult,
  AdapterVerifyResult,
  CreateIntentInput,
  PaymentAdapter,
} from './adapter.interface';
import { PaymentError } from './types';

interface StripeCfg {
  apiKey: string;
  webhookSecret: string;
  sandbox: boolean;
}

@Injectable()
export class StripeAdapter implements PaymentAdapter {
  private readonly log = new Logger(StripeAdapter.name);
  private readonly cfg: StripeCfg;
  private readonly enabled: boolean;

  readonly info: AdapterInfo;

  constructor(cs: ConfigService) {
    const a = cs.get<Record<string, unknown>>('app.adapters.stripe') ?? {};
    this.cfg = {
      apiKey: String(a['apiKey'] ?? ''),
      webhookSecret: String(a['webhookSecret'] ?? ''),
      sandbox: Boolean(a['sandbox'] ?? true),
    };
    this.enabled = Boolean(a['enabled'] ?? false);
    this.info = {
      name: 'stripe',
      enabled: this.enabled,
      sandbox: this.cfg.sandbox,
      supportedFiats: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY'],
      supportedAssets: ['RIAL'],
    };
  }

  get isEnabled(): boolean {
    return this.enabled && this.cfg.apiKey.length > 0;
  }

  private get baseUrl(): string {
    return this.cfg.sandbox ? 'https://api.stripe.com/v1' : 'https://api.stripe.com/v1';
  }

  private async stripeRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: Record<string, string>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const u = new URL(this.baseUrl + path);
      const body = form
        ? Object.entries(form)
            .map(
              ([k, v]) =>
                encodeURIComponent(k) + '=' + encodeURIComponent(v).replace(/%20/g, '+'),
            )
            .join('&')
        : '';
      const req = httpsRequest(
        {
          method,
          hostname: u.hostname,
          path: u.pathname + (u.search || ''),
          port: u.port || 443,
          headers: {
            Authorization: 'Bearer ' + this.cfg.apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 400) {
              return reject(new PaymentError('STRIPE_API_ERROR', `stripe ${res.statusCode}: ${text}`, true));
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (e) {
              reject(new PaymentError('STRIPE_PARSE_ERROR', 'invalid json from stripe', true, e));
            }
          });
        },
      );
      req.on('error', (e) => reject(new PaymentError('STRIPE_NETWORK', e.message, true, e)));
      if (body) req.write(body);
      req.end();
    });
  }

  async createIntent(input: CreateIntentInput): Promise<AdapterIntentResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'stripe adapter disabled');
    if (input.kind !== 'deposit') {
      throw new PaymentError('UNSUPPORTED_KIND', 'stripe adapter only supports deposit in this build');
    }
    const amount = Number(input.amount.amountMinor);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PaymentError('INVALID_AMOUNT', 'amount must be positive integer');
    }
    const resp = await this.stripeRequest<{
      id: string;
      status: string;
      client_secret?: string;
      next_action?: { redirect_to_url?: { url?: string } };
    }>('POST', '/payment_intents', {
      amount: String(amount),
      currency: input.amount.currency.toLowerCase(),
      'metadata[user_id]': input.userId,
      'metadata[reference]': input.reference,
      'metadata[idempotency_key]': input.idempotencyKey,
      ...(input.returnUrl ? { 'metadata[return_url]': input.returnUrl } : {}),
    });
    return {
      externalId: resp.id,
      status: 'pending',
      redirectUrl: resp.next_action?.redirect_to_url?.url ?? input.returnUrl,
      rawResponse: { client_secret: resp.client_secret, status: resp.status },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async verify(externalId: string): Promise<AdapterVerifyResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'stripe adapter disabled');
    const pi = await this.stripeRequest<{ id: string; status: string; amount: number; currency: string }>(
      'GET',
      '/payment_intents/' + encodeURIComponent(externalId),
    );
    const status = this.mapStatus(pi.status);
    return {
      externalId: pi.id,
      status,
      settledAmount:
        status === 'succeeded'
          ? { amountMinor: BigInt(pi.amount), currency: pi.currency.toUpperCase() }
          : undefined,
      rawResponse: { status: pi.status },
    };
  }

  async cancel(externalId: string, reason?: string): Promise<AdapterCancelResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'stripe adapter disabled');
    try {
      await this.stripeRequest<{ id: string; status: string }>(
        'POST',
        '/payment_intents/' + encodeURIComponent(externalId) + '/cancel',
        reason ? { cancellation_reason: 'requested_by_customer' } : {},
      );
      return { cancelled: true, reason };
    } catch (e) {
      this.log.warn('stripe cancel failed: ' + (e as Error).message);
      return { cancelled: false, reason: (e as Error).message };
    }
  }

  verifyWebhookSignature(rawBody: Buffer, _headers: Record<string, string>, signature: string): boolean {
    if (!this.cfg.webhookSecret) return false;
    if (!signature) return false;
    const parts = signature.split(',').reduce<Record<string, string>>((acc, kv) => {
      const idx = kv.indexOf('=');
      if (idx > 0) acc[kv.slice(0, idx)] = kv.slice(idx + 1);
      return acc;
    }, {});
    const t = parts['t'];
    const v1 = parts['v1'];
    if (!t || !v1) return false;
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(`${t}.`).update(rawBody).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
    } catch {
      return false;
    }
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string>, signature: string): Promise<AdapterVerifyResult> {
    if (!this.verifyWebhookSignature(rawBody, headers, signature)) {
      throw new PaymentError('INVALID_SIGNATURE', 'stripe webhook signature invalid', false);
    }
    const evt = JSON.parse(rawBody.toString('utf8')) as {
      type: string;
      data: { object: { id: string; status: string; amount?: number; currency?: string } };
    };
    const obj = evt.data.object;
    return {
      externalId: obj.id,
      status: this.mapStatus(obj.status),
      settledAmount:
        obj.amount !== undefined && obj.currency
          ? { amountMinor: BigInt(obj.amount), currency: obj.currency.toUpperCase() }
          : undefined,
      rawResponse: { type: evt.type },
    };
  }

  private mapStatus(s: string): AdapterIntentResult['status'] {
    switch (s) {
      case 'succeeded':
        return 'succeeded';
      case 'processing':
        return 'processing';
      case 'canceled':
        return 'cancelled';
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':
      case 'requires_capture':
      default:
        return 'pending';
    }
  }
}
