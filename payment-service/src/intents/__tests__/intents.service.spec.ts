// =============================================================================
// Unit tests — IntentsService durable-store contract
// Author: Qalamhiphop
// =============================================================================
import { IntentsService } from '../intents.service';
import { IntentStore } from '../intent.store';
import { AdapterRegistry } from '../../adapters/adapter.registry';
import { ManualAdapter } from '../../adapters/manual.adapter';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentIntent } from '../intent.entity';

const cfg = {
  httpPort: 50055,
  grpcPort: 50056,
  defaultAdapter: 'manual',
  defaultFiat: 'USD',
  internalToken: 'test-token',
  databaseUrl: 'postgres://test:test@localhost:5432/test',
  corsOrigins: ['*'],
  logLevel: 'info',
  limits: {
    minDepositMinor: 100n,
    maxDepositMinor: 1_000_000_000n,
    minWithdrawMinor: 1_000n,
    maxWithdrawMinor: 1_000_000_000n,
    dailyWithdrawLimitMinor: 5_000_000_000n,
    withdrawalCooldownSeconds: 300,
  },
  adapters: {
    manual: { enabled: true, sandbox: false, instructions: '' },
    stripe: { enabled: false, sandbox: true },
    zarinpal: { enabled: false, sandbox: true },
    nowpayments: { enabled: false, sandbox: true },
  },
};

class MemoryIntentStore {
  private readonly byId = new Map<string, PaymentIntent>();
  private readonly byIdempotency = new Map<string, string>();

  async create(intent: PaymentIntent): Promise<boolean> {
    const key = `${intent.userId}\u0000${intent.idempotencyKey}`;
    if (this.byIdempotency.has(key)) return false;
    this.byId.set(intent.id, { ...intent });
    this.byIdempotency.set(key, intent.id);
    return true;
  }

  async save(intent: PaymentIntent): Promise<PaymentIntent> {
    this.byId.set(intent.id, { ...intent });
    return intent;
  }

  async get(id: string): Promise<PaymentIntent | undefined> {
    return this.byId.get(id);
  }

  async findByIdempotency(userId: string, key: string): Promise<PaymentIntent | undefined> {
    const id = this.byIdempotency.get(`${userId}\u0000${key}`);
    return id ? this.byId.get(id) : undefined;
  }

  async findByExternalId(adapter: string, externalId: string): Promise<PaymentIntent | undefined> {
    return [...this.byId.values()].find((intent) => intent.adapter === adapter && intent.externalId === externalId);
  }

  async list(f: { userId?: string; page: number; pageSize: number }) {
    const all = [...this.byId.values()]
      .filter((intent) => !f.userId || intent.userId === f.userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (f.page - 1) * f.pageSize;
    return { items: all.slice(start, start + f.pageSize), total: all.length };
  }
}

const cs = { get: () => cfg } as unknown as ConfigService;

describe('IntentsService', () => {
  let service: IntentsService;

  beforeEach(() => {
    const manual = new ManualAdapter(cs);
    const store = new MemoryIntentStore() as unknown as IntentStore;
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    service = new IntentsService(cfg, registry, store);
  });

  it('rejects amount below minimum', async () => {
    await expect(service.createDeposit({
      userId: 'u1', adapter: 'manual', amount: { amountMinor: 1n, currency: 'USD' },
      reference: 'r', idempotencyKey: 'idem_min',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a deposit', async () => {
    const r = await service.createDeposit({
      userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'r1', idempotencyKey: 'idem_1',
    });
    expect(r.id).toMatch(/^pi_/);
    expect(r.status).toBe('pending');
  });

  it('honours idempotency key', async () => {
    const args = { userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'USD' }, reference: 'r1', idempotencyKey: 'idem_same' };
    const a = await service.createDeposit(args);
    const b = await service.createDeposit(args);
    expect(b.id).toBe(a.id);
  });

  it('rejects missing destination on withdrawal', async () => {
    await expect(service.createWithdrawal({
      userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'USD' },
      destination: '', reference: 'r1', idempotencyKey: 'idem_w1',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 on unknown intent', async () => {
    await expect(service.get('pi_nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists intents paginated', async () => {
    for (let i = 0; i < 5; i++) {
      await service.createDeposit({
        userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'USD' },
        reference: 'r' + i, idempotencyKey: 'k' + i,
      });
    }
    const r = await service.list({ userId: 'u1', page: 1, pageSize: 3 });
    expect(r.items).toHaveLength(3);
    expect(r.total).toBe(5);
  });
});
