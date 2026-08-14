// =============================================================================
//  Unit tests — ManualAdapter
//  Author: Qalamhiphop
// =============================================================================
import { ManualAdapter } from '../manual.adapter';
import { ConfigService } from '@nestjs/config';

describe('ManualAdapter', () => {
  const cs = { get: jest.fn().mockReturnValue('Contact treasury@rial.example') } as unknown as ConfigService;
  const adapter = new ManualAdapter(cs);

  it('reports always-enabled info', () => {
    expect(adapter.info.name).toBe('manual');
    expect(adapter.info.enabled).toBe(true);
  });

  it('creates a pending deposit', async () => {
    const r = await adapter.createIntent({
      userId: 'usr_1',
      kind: 'deposit',
      amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'ref_1',
      idempotencyKey: 'idem_1',
      metadata: {},
    });
    expect(r.externalId).toMatch(/^manual_/);
    expect(r.status).toBe('pending');
    expect(r.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      adapter.createIntent({
        userId: 'usr_1',
        kind: 'deposit',
        amount: { amountMinor: 0n, currency: 'USD' },
        reference: 'ref_2',
        idempotencyKey: 'idem_2',
        metadata: {},
      }),
    ).rejects.toThrow(/INVALID_AMOUNT|amount must be positive/);
  });

  it('cancels successfully', async () => {
    const r = await adapter.cancel('manual_abc', 'test');
    expect(r.cancelled).toBe(true);
  });
});
