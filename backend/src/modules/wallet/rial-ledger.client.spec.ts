import { RialLedgerClient } from './rial-ledger.client';

describe('RialLedgerClient', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.WALLET_INTERNAL_TOKEN = 'test-internal-token';
    process.env.WALLET_SERVICE_URL = 'http://wallet-service:50052';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends escrow amounts as decimal strings', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'tx-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new RialLedgerClient();
    await client.reserve('11111111-1111-1111-1111-111111111111', '9007199254740991', 'order-1', 'reserve-order-1');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).amount).toBe('9007199254740991');
  });
});
