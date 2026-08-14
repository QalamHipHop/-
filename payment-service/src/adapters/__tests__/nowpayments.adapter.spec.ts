// =============================================================================
//  Unit tests — NowPaymentsAdapter signature verification
//  Author: Qalamhiphop
// =============================================================================
import { NowPaymentsAdapter } from '../nowpayments.adapter';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

describe('NowPaymentsAdapter', () => {
  const secret = 'ipn_secret_test';
  const cfg = {
    get: jest.fn().mockReturnValue({ apiKey: 'k', ipnSecret: secret, sandbox: true, enabled: true }),
  } as unknown as ConfigService;
  const adapter = new NowPaymentsAdapter(cfg);

  it('verifies valid HMAC-SHA512 signature', () => {
    const body = Buffer.from(JSON.stringify({ payment_id: 'np_1', payment_status: 'finished' }));
    const sig = createHmac('sha512', secret).update(body).digest('hex');
    expect(adapter.verifyWebhookSignature(body, {}, sig)).toBe(true);
  });

  it('rejects bad signature', () => {
    const body = Buffer.from('{}');
    expect(adapter.verifyWebhookSignature(body, {}, 'a'.repeat(128))).toBe(false);
  });

  it('rejects missing signature', () => {
    expect(adapter.verifyWebhookSignature(Buffer.from('x'), {}, '')).toBe(false);
  });

  it('parses IPN correctly', async () => {
    const body = Buffer.from(JSON.stringify({ payment_id: 'np_1', payment_status: 'finished' }));
    const sig = createHmac('sha512', secret).update(body).digest('hex');
    const r = await adapter.parseWebhook(body, {}, sig);
    expect(r.externalId).toBe('np_1');
    expect(r.status).toBe('succeeded');
  });
});
