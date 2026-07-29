// =============================================================================
//  NOWPayments adapter — crypto payment gateway
//  Author: QalamCode
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

interface NowPaymentsCfg {
  apiKey: string;
  ipnSecret: string;
  sandbox: boolean;
}

interface NowPaymentsPayment {
  payment_id: string;
  payment_status: string;
  pay_address?: string;
  pay_amount?: number;
  pay_currency?: string;
  price_amount?: number;
  price_currency?: string;
}

@Injectable()
export class NowPaymentsAdapter implements PaymentAdapter {
  private readonly log = new Logger(NowPaymentsAdapter.name);
  private readonly cfg: NowPaymentsCfg;
  private readonly enabled: boolean;

  readonly info: AdapterInfo;

  constructor(cs: ConfigService) {
    const a = cs.get<Record<string, unknown>>('app.adapters.nowpayments') ?? {};
    this.cfg = {
      apiKey: String(a['apiKey'] ?? ''),
      ipnSecret: String(a['ipnSecret'] ?? ''),
      sandbox: Boolean(a['sandbox'] ?? true),
    };
    this.enabled = Boolean(a['enabled'] ?? false);
    this.info = {
      name: 'nowpayments',
      enabled: this.enabled,
      sandbox: this.cfg.sandbox,
      supportedFiats: ['USD', 'EUR'],
      supportedAssets: ['BTC', 'ETH', 'USDT', 'LTC', 'BNB', 'SOL', 'TRX', 'DOGE'],
    };
  }

  get isEnabled(): boolean {
    return this.enabled && this.cfg.apiKey.length > 0;
  }

  private get baseUrl(): string {
    return 'https://api.nowpayments.io/v1';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const u = new URL(this.baseUrl + path);
      const data = body ? JSON.stringify(body) : '';
      const req = httpsRequest(
        {
          method,
          hostname: u.hostname,
          path: u.pathname + (u.search || ''),
          port: 443,
          headers: {
            'x-api-key': this.cfg.apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 400) {
              return reject(
                new PaymentError('NOWPAYMENTS_API_ERROR', `nowpayments ${res.statusCode}: ${text}`, true),
              );
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (e) {
              reject(new PaymentError('NOWPAYMENTS_PARSE_ERROR', 'invalid json', true, e));
            }
          });
        },
      );
      req.on('error', (e) => reject(new PaymentError('NOWPAYMENTS_NETWORK', e.message, true, e)));
      if (data) req.write(data);
      req.end();
    });
  }

  async createIntent(input: CreateIntentInput): Promise<AdapterIntentResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'nowpayments adapter disabled');
    if (input.kind !== 'deposit') {
      throw new PaymentError('UNSUPPORTED_KIND', 'nowpayments adapter only supports deposit in this build');
    }
    const payCurrency = (input.metadata['pay_currency'] ?? 'btc').toLowerCase();
    const resp = await this.call<NowPaymentsPayment>('POST', '/payment', {
      price_amount: Number(input.amount.amountMinor) / 100,
      price_currency: input.amount.currency.toLowerCase(),
      pay_currency: payCurrency,
      order_id: input.reference,
      order_description: 'RIAL deposit ' + input.reference,
      ipn_callback_url: input.returnUrl || input.metadata['ipn_callback_url'] || '',
    });
    return {
      externalId: resp.payment_id,
      status: 'pending',
      qrCode: resp.pay_address,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      rawResponse: { pay_address: resp.pay_address, pay_amount: resp.pay_amount, pay_currency: resp.pay_currency },
    };
  }

  async verify(externalId: string): Promise<AdapterVerifyResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'nowpayments adapter disabled');
    const p = await this.call<NowPaymentsPayment>('GET', '/payment/' + encodeURIComponent(externalId));
    return {
      externalId: p.payment_id,
      status: this.mapStatus(p.payment_status),
      settledAmount:
        p.price_amount !== undefined && p.price_currency
          ? { amountMinor: BigInt(Math.round(p.price_amount * 100)), currency: p.price_currency.toUpperCase() }
          : undefined,
      rawResponse: { status: p.payment_status },
    };
  }

  async cancel(externalId: string, reason?: string): Promise<AdapterCancelResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'nowpayments adapter disabled');
    try {
      await this.call<unknown>('POST', '/payment/' + encodeURIComponent(externalId) + '/cancel');
      return { cancelled: true, reason };
    } catch (e) {
      return { cancelled: false, reason: (e as Error).message };
    }
  }

  verifyWebhookSignature(rawBody: Buffer, _headers: Record<string, string>, signature: string): boolean {
    if (!this.cfg.ipnSecret || !signature) return false;
    const expected = createHmac('sha512', this.cfg.ipnSecret).update(rawBody).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>, signature: string): Promise<AdapterVerifyResult> {
    if (!this.verifyWebhookSignature(rawBody, _headers, signature)) {
      throw new PaymentError('INVALID_SIGNATURE', 'nowpayments ipn signature invalid', false);
    }
    const evt = JSON.parse(rawBody.toString('utf8')) as NowPaymentsPayment;
    return {
      externalId: evt.payment_id,
      status: this.mapStatus(evt.payment_status),
      rawResponse: { status: evt.payment_status },
    };
  }

  private mapStatus(s: string): AdapterIntentResult['status'] {
    switch (s) {
      case 'finished':
        return 'succeeded';
      case 'confirming':
      case 'sending':
      case 'partially_paid':
        return 'processing';
      case 'failed':
      case 'refunded':
        return 'failed';
      case 'expired':
        return 'expired' as unknown as AdapterIntentResult['status'];
      default:
        return 'pending';
    }
  }
}
