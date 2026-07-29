// =============================================================================
//  ZarinPal adapter — Iranian fiat gateway (REST + sandbox)
//  Author: QalamCode
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
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

interface ZarinPalCfg {
  merchantId: string;
  sandbox: boolean;
  callbackUrl: string;
}

interface ZarinPalRequestResp {
  data: { authority: string; code: number };
  errors: unknown;
}

interface ZarinPalVerifyResp {
  data: { code: number; ref_id?: number; card_pan?: string; fee_type?: string; fee?: number };
  errors: unknown;
}

@Injectable()
export class ZarinPalAdapter implements PaymentAdapter {
  private readonly log = new Logger(ZarinPalAdapter.name);
  private readonly cfg: ZarinPalCfg;
  private readonly enabled: boolean;

  readonly info: AdapterInfo;

  constructor(cs: ConfigService) {
    const a = cs.get<Record<string, unknown>>('app.adapters.zarinpal') ?? {};
    this.cfg = {
      merchantId: String(a['merchantId'] ?? ''),
      sandbox: Boolean(a['sandbox'] ?? true),
      callbackUrl: String(a['callbackUrl'] ?? ''),
    };
    this.enabled = Boolean(a['enabled'] ?? false);
    this.info = {
      name: 'zarinpal',
      enabled: this.enabled,
      sandbox: this.cfg.sandbox,
      supportedFiats: ['IRR', 'IRT'],
      supportedAssets: ['RIAL'],
    };
  }

  get isEnabled(): boolean {
    return this.enabled && this.cfg.merchantId.length > 0;
  }

  private get baseUrl(): string {
    return this.cfg.sandbox
      ? 'https://sandbox.zarinpal.com/pg/v4/payment'
      : 'https://api.zarinpal.com/pg/v4/payment';
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const u = new URL(this.baseUrl + path);
      const data = JSON.stringify(body);
      const req = httpsRequest(
        {
          method: 'POST',
          hostname: u.hostname,
          path: u.pathname,
          port: 443,
          headers: {
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
                new PaymentError('ZARINPAL_API_ERROR', `zarinpal ${res.statusCode}: ${text}`, true),
              );
            }
            try {
              resolve(JSON.parse(text) as T);
            } catch (e) {
              reject(new PaymentError('ZARINPAL_PARSE_ERROR', 'invalid json', true, e));
            }
          });
        },
      );
      req.on('error', (e) => reject(new PaymentError('ZARINPAL_NETWORK', e.message, true, e)));
      req.write(data);
      req.end();
    });
  }

  async createIntent(input: CreateIntentInput): Promise<AdapterIntentResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'zarinpal adapter disabled');
    if (input.kind !== 'deposit') {
      throw new PaymentError('UNSUPPORTED_KIND', 'zarinpal adapter only supports deposit in this build');
    }
    // ZarinPal amounts are in Tomans (IRR / 10) or full IRR depending on merchant config.
    // We treat input.amount.amountMinor as IRR (rial) and convert to Tomans by /10.
    const tomans = input.amount.amountMinor / 10n;
    if (tomans <= 0n) throw new PaymentError('INVALID_AMOUNT', 'amount too small');

    const resp = await this.call<ZarinPalRequestResp>('/request.json', {
      merchant_id: this.cfg.merchantId,
      amount: Number(tomans),
      callback_url: input.returnUrl || this.cfg.callbackUrl,
      description: input.metadata['description'] ?? 'RIAL deposit ' + input.reference,
      metadata: {
        user_id: input.userId,
        reference: input.reference,
        idempotency_key: input.idempotencyKey,
      },
    });
    if (resp.data.code !== 100) {
      throw new PaymentError('ZARINPAL_REJECTED', 'zarinpal rejected request: code=' + resp.data.code, false, resp);
    }
    const authority = resp.data.authority;
    const redirectUrl = this.cfg.sandbox
      ? `https://sandbox.zarinpal.com/pg/StartPay/${authority}`
      : `https://www.zarinpal.com/pg/StartPay/${authority}`;
    return {
      externalId: authority,
      status: 'pending',
      redirectUrl,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      rawResponse: { authority, code: resp.data.code },
    };
  }

  async verify(externalId: string): Promise<AdapterVerifyResult> {
    if (!this.isEnabled) throw new PaymentError('ADAPTER_DISABLED', 'zarinpal adapter disabled');
    const resp = await this.call<ZarinPalVerifyResp>('/verify.json', {
      merchant_id: this.cfg.merchantId,
      authority: externalId,
    });
    const code = resp.data.code;
    if (code === 100 || code === 101) {
      return {
        externalId,
        status: 'succeeded',
        settledAmount: { amountMinor: 0n, currency: 'IRR' },
        rawResponse: { ref_id: resp.data.ref_id, code },
      };
    }
    return { externalId, status: 'failed', failureReason: 'code=' + code, rawResponse: resp as unknown as Record<string, unknown> };
  }

  async cancel(externalId: string, reason?: string): Promise<AdapterCancelResult> {
    // ZarinPal doesn't have a "cancel" endpoint — operator must void manually.
    this.log.warn(`zarinpal cancel not supported authority=${externalId} reason=${reason ?? 'n/a'}`);
    return { cancelled: false, reason: 'zarinpal does not support remote cancel' };
  }

  verifyWebhookSignature(_rawBody: Buffer, _headers: Record<string, string>, _signature: string): boolean {
    // ZarinPal uses callback URL pattern (no signature); auth by callback URL + authority.
    return true;
  }

  async parseWebhook(rawBody: Buffer, _headers: Record<string, string>, _signature: string): Promise<AdapterVerifyResult> {
    const params = new URLSearchParams(rawBody.toString('utf8'));
    const authority = params.get('Authority') ?? params.get('authority') ?? '';
    const status = params.get('Status') ?? params.get('status') ?? '';
    if (!authority) throw new PaymentError('INVALID_WEBHOOK', 'missing authority', false);
    const ok = status === 'OK' || status.toUpperCase() === 'OK';
    return {
      externalId: authority,
      status: ok ? 'succeeded' : 'failed',
      failureReason: ok ? undefined : 'status=' + status,
      rawResponse: { authority, status },
    };
  }
}
