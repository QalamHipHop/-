import { OutboxWorker } from './outbox.worker';

describe('OutboxWorker', () => {
  function setup(rows: unknown[], publish: jest.Mock) {
    const query = jest.fn().mockResolvedValue({ rows });
    const db = {
      withTransaction: jest.fn(async (fn: (tx: { query: typeof query }) => Promise<unknown>) => fn({ query })),
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const bus = { publishDurable: publish };
    return { worker: new OutboxWorker(db as never, bus as never), db };
  }

  it('marks an event published only after durable broker acknowledgement', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const { worker, db } = setup([{ id: 'evt-1', event_type: 'wallet.credit', payload: { amount: 5 }, attempts: 0 }], publish);

    await (worker as unknown as { tick: () => Promise<void> }).tick();

    expect(publish).toHaveBeenCalledWith('wallet.credit', { amount: 5 }, 'evt-1');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('published_at = now()'), ['evt-1']);
  });

  it('keeps an event unpublished and schedules backoff after broker failure', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('nats unavailable'));
    const { worker, db } = setup([{ id: 'evt-2', event_type: 'wallet.debit', payload: { amount: 7 }, attempts: 2 }], publish);

    await (worker as unknown as { tick: () => Promise<void> }).tick();

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('next_attempt_at'), ['evt-2', 3, 'nats unavailable', 8]);
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('published_at = now()'), expect.anything());
  });
});
