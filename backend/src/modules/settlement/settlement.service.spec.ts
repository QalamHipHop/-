import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';

import { SettlementService } from './settlement.service';
import { settlementConfig } from '../../config/settlement.config';
import { RateProvider } from './providers/rate-provider.interface';

const redisMock = {
  mget: jest.fn().mockResolvedValue([null, null]),
  set: jest.fn().mockResolvedValue('OK'),
};

const fixedProvider: RateProvider = { name: 'fixed', quote: async () => 1, healthy: async () => true };
const floatingProvider: RateProvider = { name: 'floating', quote: async () => null, healthy: async () => false };
const externalProvider: RateProvider = { name: 'external', quote: async () => null, healthy: async () => false };

describe('SettlementService', () => {
  let svc: SettlementService;

  beforeEach(async () => {
    redisMock.mget.mockReset().mockResolvedValue([null, null]);
    redisMock.set.mockReset().mockResolvedValue('OK');
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ load: [settlementConfig], ignoreEnvFile: true })],
      providers: [
        SettlementService,
        ConfigService,
        { provide: 'RATE_PROVIDERS', useValue: [fixedProvider, floatingProvider, externalProvider] },
        { provide: 'REDIS_CLIENT', useValue: redisMock },
      ],
    }).compile();
    svc = mod.get(SettlementService);
  });

  it('uses the first healthy provider', async () => {
    const r = await svc.currentRate();
    expect(r.usdPerUnit).toBe(1);
    expect(r.source).toBe('fixed');
    expect(r.stale).toBe(false);
  });

  it('converts USD → RIAL minor without floating-point arithmetic', async () => {
    const minor = await svc.convertUsdToRial('123.45');
    // rate = 1 USD / RIAL, 123.45 USD = 123.45 RIAL = 12,345,000,000 minor
    expect(minor.toString()).toBe('12345000000');
  });

  it('converts large RIAL minor values to an exact USD string', async () => {
    const usd = await svc.convertRialToUsd(900719925474099100n);
    expect(usd).toBe('9007199254.74099100');
  });

  it('throws when no rate available', async () => {
    const noProv: RateProvider = { name: 'none', quote: async () => null, healthy: async () => false };
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ load: [settlementConfig], ignoreEnvFile: true })],
      providers: [
        SettlementService,
        ConfigService,
        { provide: 'RATE_PROVIDERS', useValue: [noProv] },
        { provide: 'REDIS_CLIENT', useValue: redisMock },
      ],
    }).compile();
    const s = mod.get(SettlementService);
    await expect(s.convertUsdToRial(1)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('toMinor / fromMinor round-trip', () => {
    expect(svc.toMinor('12.34').toString()).toBe('1234000000');
    expect(svc.fromMinor(1234000000n)).toBe('12.34000000');
    expect(svc.fromMinor(svc.toMinor('0.00000001'))).toBe('0.00000001');
    expect(svc.toMinor('-1.5').toString()).toBe('-150000000');
  });

  it('rejects garbage toMinor', () => {
    expect(() => svc.toMinor('abc')).toThrow();
    expect(() => svc.toMinor('1.2.3')).toThrow();
  });

  it('serves cached rate when fresh', async () => {
    const now = new Date().toISOString();
    redisMock.mget.mockResolvedValueOnce(['0.5', now]);
    const r = await svc.currentRate();
    expect(r.usdPerUnit).toBe(0.5);
    expect(r.source).toBe('cache');
    expect(r.stale).toBe(false);
  });
});
