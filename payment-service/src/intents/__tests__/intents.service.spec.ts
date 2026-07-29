// =============================================================================
//  Unit tests — IntentsService (idempotency, validation)
//  Author: QalamCode
// =============================================================================
import { IntentsService } from '../intents.service';
import { IntentStore } from '../intent.store';
import { AdapterRegistry } from '../../adapters/adapter.registry';
import { ManualAdapter } from '../../adapters/manual.adapter';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const cfg: AppConfigLike = {
  httpPort: 50055,
  grpcPort: 50056,
  defaultAdapter: 'manual',
  defaultFiat: 'USD',
  internalToken: 'x',
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

interface AppConfigLike {
  httpPort: number;
  grpcPort: number;
  defaultAdapter: string;
  defaultFiat: string;
  internalToken: string;
  corsOrigins: string[];
  logLevel: string;
  limits: {
    minDepositMinor: bigint;
    maxDepositMinor: bigint;
    minWithdrawMinor: bigint;
    maxWithdrawMinor: bigint;
    dailyWithdrawLimitMinor: bigint;
    withdrawalCooldownSeconds: number;
  };
  adapters: Record<string, { enabled: boolean; sandbox: boolean; [k: string]: unknown }>;
}

const cs = { get: () => cfg } as unknown as ConfigService;

describe('IntentsService', () => {
  let service: IntentsService;

  beforeEach(() => {
    const manual = new ManualAdapter(cs);
    const store = new IntentStore();
    const registry = new AdapterRegistry(manual, {} as any, {} as any, {} as any);
    service = new IntentsService(cfg, registry, store);
  });

  it('rejects amount below minimum', async () => {
    await expect(
      service.createDeposit({
        userId: 'u1',
        adapter: 'manual',
        amount: { amountMinor: 1n, currency: 'USD' },
        reference: 'r',
        idempotencyKey: 'idem_min',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a deposit', async () => {
    const r = await service.createDeposit({
      userId: 'u1',
      adapter: 'manual',
      amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'r1',
      idempotencyKey: 'idem_1',
    });
    expect(r.id).toMatch(/^pi_/);
    expect(r.status).toBe('pending');
  });

  it('honours idempotency key', async () => {
    const a = await service.createDeposit({
      userId: 'u1',
      adapter: 'manual',
      amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'r1',
      idempotencyKey: 'idem_same',
    });
    const b = await service.createDeposit({
      userId: 'u1',
      adapter: 'manual',
      amount: { amountMinor: 10_000n, currency: 'USD' },
      reference: 'r1',
      idempotencyKey: 'idem_same',
    });
    expect(b.id).toBe(a.id);
  });

  it('rejects missing destination on withdrawal', async () => {
    await expect(
      service.createWithdrawal({
        userId: 'u1',
        adapter: 'manual',
        amount: { amountMinor: 10_000n, currency: 'USD' },
        destination: '',
        reference: 'r1',
        idempotencyKey: 'idem_w1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 on unknown intent', () => {
    expect(() => service.get('pi_nope')).toThrow(NotFoundException);
  });

  it('lists intents paginated', async () => {
    for (let i = 0; i < 5; i++) {
      await service.createDeposit({
        userId: 'u1',
        adapter: 'manual',
        amount: { amountMinor: 10_000n, currency: 'USD' },
        reference: 'r' + i,
        idempotencyKey: 'k' + i,
      });
    }
    const r = service.list({ userId: 'u1', page: 1, pageSize: 3 });
    expect(r.items).toHaveLength(3);
    expect(r.total).toBe(5);
  });
});
