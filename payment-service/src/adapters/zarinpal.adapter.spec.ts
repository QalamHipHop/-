import { ConfigService } from '@nestjs/config';
import { ZarinPalAdapter } from './zarinpal.adapter';

describe('ZarinPalAdapter', () => {
  function adapter() {
    const config = { get: jest.fn().mockReturnValue({ enabled: true, merchantId: 'merchant-test', sandbox: true, callbackUrl: 'https://example.test/callback' }) } as unknown as ConfigService;
    return new ZarinPalAdapter(config);
  }

  it('rejects IRR values that cannot be represented as whole toman', async () => {
    await expect(adapter().createIntent({
      userId: 'u1', kind: 'deposit', amount: { amountMinor: 101n, currency: 'IRR' }, reference: 'ref-1', idempotencyKey: 'idempotency-1', metadata: {},
    })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});
