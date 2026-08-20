import { WebhooksController } from './webhooks.controller';

describe('WebhooksController', () => {
  it('server-verifies ZarinPal callbacks instead of trusting browser Status=OK', async () => {
    const adapter = {
      parseWebhook: jest.fn().mockResolvedValue({ externalId: 'authority-1', status: 'succeeded' }),
      verify: jest.fn().mockResolvedValue({ externalId: 'authority-1', status: 'failed', failureReason: 'provider-not-paid' }),
    };
    const registry = { get: jest.fn().mockReturnValue(adapter) };
    const intents = { findByExternalId: jest.fn().mockResolvedValue(undefined) };
    const store = { recordWebhookEvent: jest.fn().mockResolvedValue(true), markWebhookProcessed: jest.fn().mockResolvedValue(undefined) };
    const controller = new WebhooksController(registry as never, intents as never, store as never);

    const result = await controller.handle('zarinpal', { rawBody: Buffer.from('Authority=authority-1&Status=OK') } as never, {} as never, {});

    expect(adapter.verify).toHaveBeenCalledWith('authority-1');
    expect(store.recordWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'authority-1', type: 'failed' }));
    expect(result).toEqual({ ok: true, intent: null });
  });
});
