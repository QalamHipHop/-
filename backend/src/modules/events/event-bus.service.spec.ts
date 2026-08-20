import { EventBusService } from './event-bus.service';

describe('EventBusService production boundary', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('fails module initialization when JetStream is unavailable in production', async () => {
    process.env.NODE_ENV = 'production';
    const bus = new EventBusService(null, { get: jest.fn() } as any);

    await expect(bus.onModuleInit()).rejects.toThrow('NATS JetStream is required in production');
  });

  it('does not report a successful publish without JetStream in production', async () => {
    process.env.NODE_ENV = 'production';
    const bus = new EventBusService(null, { get: jest.fn() } as any);

    await expect(bus.publish('wallet.transfer.completed', { amountMinor: '1' })).rejects.toThrow(
      'NATS JetStream unavailable in production',
    );
  });

  it('keeps local fanout available outside production when NATS is unavailable', async () => {
    process.env.NODE_ENV = 'test';
    const bus = new EventBusService(null, { get: jest.fn() } as any);
    const handler = jest.fn();
    await bus.subscribe('test.subject', handler);

    await bus.publish('test.subject', { ok: true });

    expect(handler).toHaveBeenCalledWith({ ok: true }, { ok: true });
  });
});
