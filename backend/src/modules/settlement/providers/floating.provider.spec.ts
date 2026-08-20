import { FloatingRateProvider } from './floating.provider';

function makeProvider(values: [string | null, string | null]) {
  const redis = { mget: jest.fn().mockResolvedValue(values), set: jest.fn() } as any;
  const config = {
    get: jest.fn().mockReturnValue({ rateStrategy: 'floating', rateStaleAfterSec: 300 }),
  } as any;
  return { provider: new FloatingRateProvider(config, redis), redis };
}

describe('FloatingRateProvider', () => {
  it('fails closed when TWAP is missing', async () => {
    const { provider } = makeProvider([null, null]);
    await expect(provider.quote()).resolves.toBeNull();
    await expect(provider.healthy()).resolves.toBe(false);
  });

  it('fails closed when TWAP is stale', async () => {
    const { provider } = makeProvider(['0.00001', String(Math.floor(Date.now() / 1000) - 301)]);
    await expect(provider.quote()).resolves.toBeNull();
  });

  it('returns only a fresh trusted TWAP and never mutates it', async () => {
    const { provider, redis } = makeProvider(['0.0000123', String(Math.floor(Date.now() / 1000))]);
    await expect(provider.quote()).resolves.toBeCloseTo(0.0000123);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
