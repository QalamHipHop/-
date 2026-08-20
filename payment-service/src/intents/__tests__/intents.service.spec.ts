// =============================================================================
// Unit tests — IntentsService durable-store contract
// Author: Qalamhiphop
// =============================================================================
import { IntentsService } from '../intents.service';
import { IntentStore, PaymentRefund } from '../intent.store';
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
  private readonly refunds = new Map<string, PaymentRefund>();
  private readonly refundKeys = new Map<string, string>();

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

  async markSettlementPending(id: string): Promise<void> {
    const intent = this.byId.get(id);
    if (intent) this.byId.set(id, { ...intent, settlementStatus: 'pending' });
  }

  async markSettlementFailed(id: string): Promise<void> {
    const intent = this.byId.get(id);
    if (intent) this.byId.set(id, { ...intent, settlementStatus: 'failed' });
  }

  async markSettlementSucceeded(id: string): Promise<void> {
    const intent = this.byId.get(id);
    if (intent) this.byId.set(id, { ...intent, settlementStatus: 'succeeded' });
  }

  async listSettlementRecovery(): Promise<PaymentIntent[]> { return []; }

  async createRefund(refund: PaymentRefund): Promise<PaymentRefund | null> {
    const key = `${refund.userId}:${refund.idempotencyKey}`;
    if (this.refundKeys.has(key)) return null;
    this.refunds.set(refund.id, { ...refund });
    this.refundKeys.set(key, refund.id);
    return refund;
  }

  async findRefundByIdempotency(userId: string, key: string): Promise<PaymentRefund | undefined> {
    const id = this.refundKeys.get(`${userId}:${key}`);
    return id ? this.refunds.get(id) : undefined;
  }

  async saveRefund(refund: PaymentRefund): Promise<PaymentRefund> {
    this.refunds.set(refund.id, { ...refund });
    return refund;
  }

  async listRefunds(intentId: string): Promise<PaymentRefund[]> {
    return [...this.refunds.values()].filter((refund) => refund.intentId === intentId);
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

  it('refunds a succeeded deposit exactly once per idempotency key', async () => {
    const created = await service.createDeposit({ userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'USD' }, reference: 'refund-ref', idempotencyKey: 'refund-intent' });
    const intent = await (service as any).store.get(created.id);
    intent.status = 'succeeded';
    intent.externalId = 'manual_external';
    await (service as any).store.save(intent);
    const first = await service.refund(created.id, 'u1', undefined, 'customer request', 'refund-key');
    const second = await service.refund(created.id, 'u1', undefined, 'customer request', 'refund-key');
    expect(first.id).toBe(second.id);
    expect(first.status).toBe('processing');
  });

  it('settles a successful deposit once across duplicate success callbacks', async () => {
    const store = new MemoryIntentStore() as unknown as IntentStore;
    let creditCalls = 0;
    const wallet = { creditDeposit: async () => { creditCalls += 1; return 'wallet-tx-1'; } } as any;
    const manual = new ManualAdapter(cs);
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    const svc = new IntentsService(cfg, registry, store, wallet);
    const created = await svc.createDeposit({ userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'RIAL' }, reference: 'verify-ref', idempotencyKey: 'verify-intent' });
    const first = await svc.applyVerifyResult(created.id, 'succeeded', { amountMinor: 10_000n, currency: 'RIAL' });
    const second = await svc.applyVerifyResult(created.id, 'succeeded', { amountMinor: 10_000n, currency: 'RIAL' });
    expect(first?.status).toBe('succeeded');
    expect(second?.status).toBe('succeeded');
    expect(creditCalls).toBe(1);
  });

  it('converts whole IRR into eight-decimal internal RIAL before wallet settlement', async () => {
    const store = new MemoryIntentStore() as unknown as IntentStore;
    let settledAmount = 0n;
    const wallet = { creditDeposit: async (input: { amountMinor: bigint }) => { settledAmount = input.amountMinor; return 'wallet-tx-irr'; } } as any;
    const manual = new ManualAdapter(cs);
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    const svc = new IntentsService(cfg, registry, store, wallet);
    const created = await svc.createDeposit({ userId: 'u1', adapter: 'manual', amount: { amountMinor: 25_000n, currency: 'IRR' }, reference: 'irr-ref', idempotencyKey: 'irr-intent' });
    await svc.applyVerifyResult(created.id, 'succeeded', { amountMinor: 25_000n, currency: 'IRR' });
    expect(settledAmount).toBe(2_500_000_000_000n);
  });

  it('converts whole IRT into ten-times-RIAL at eight internal decimals', async () => {
    const store = new MemoryIntentStore() as unknown as IntentStore;
    let settledAmount = 0n;
    const wallet = { creditDeposit: async (input: { amountMinor: bigint }) => { settledAmount = input.amountMinor; return 'wallet-tx-irt'; } } as any;
    const manual = new ManualAdapter(cs);
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    const svc = new IntentsService(cfg, registry, store, wallet);
    const created = await svc.createDeposit({ userId: 'u1', adapter: 'manual', amount: { amountMinor: 25_000n, currency: 'IRT' }, reference: 'irt-ref', idempotencyKey: 'irt-intent' });
    await svc.applyVerifyResult(created.id, 'succeeded', { amountMinor: 25_000n, currency: 'IRT' });
    expect(settledAmount).toBe(25_000_000_000_000n);
  });

  it('does not let an older failed callback overwrite a succeeded intent', async () => {
    const store = new MemoryIntentStore() as unknown as IntentStore;
    const wallet = { creditDeposit: async () => 'wallet-tx-2' } as any;
    const manual = new ManualAdapter(cs);
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    const svc = new IntentsService(cfg, registry, store, wallet);
    const created = await svc.createDeposit({ userId: 'u1', adapter: 'manual', amount: { amountMinor: 10_000n, currency: 'RIAL' }, reference: 'order-ref', idempotencyKey: 'order-intent' });
    await svc.applyVerifyResult(created.id, 'succeeded', { amountMinor: 10_000n, currency: 'RIAL' });
    const stale = await svc.applyVerifyResult(created.id, 'failed', undefined, 'late provider failure');
    expect(stale?.status).toBe('succeeded');
    expect(stale?.failureReason).toBeUndefined();
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
