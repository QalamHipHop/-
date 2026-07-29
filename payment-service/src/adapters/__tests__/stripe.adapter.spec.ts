// =============================================================================
//  Unit tests — StripeAdapter signature verification
//  Author: QalamCode
// =============================================================================
import { StripeAdapter } from '../stripe.adapter';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

describe('StripeAdapter', () => {
  const secret = 'whsec_test_secret';
  const cfg = {
    get: jest.fn().mockReturnValue({ apiKey: '', webhookSecret: secret, sandbox: true, enabled: true }),
  } as unknown as ConfigService;
  const adapter = new StripeAdapter(cfg);

  it('rejects when disabled', () => {
    const off = new StripeAdapter({
      get: jest.fn().mockReturnValue({ apiKey: '', webhookSecret: '', sandbox: true, enabled: false }),
    } as unknown as ConfigService);
    expect(off.isEnabled).toBe(false);
  });

  it('verifies valid Stripe-Signature', () => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}', 'utf8');
    const signedPayload = Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), payload]);
    const sig = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${ts},v1=${sig}`;
    expect(adapter.verifyWebhookSignature(payload, {}, header)).toBe(true);
  });

  it('rejects bad signature', () => {
    const ts = '1700000000';
    const payload = Buffer.from('{}', 'utf8');
    const header = `t=${ts},v1=deadbeef`;
    expect(adapter.verifyWebhookSignature(payload, {}, header)).toBe(false);
  });

  it('rejects missing signature', () => {
    expect(adapter.verifyWebhookSignature(Buffer.from('x'), {}, '')).toBe(false);
  });
});
