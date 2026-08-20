import { WalletService } from './wallet.service';

describe('WalletService RIAL authority boundary', () => {
  function service() {
    return new WalletService({} as never, {} as never, {} as never, {} as never);
  }

  it('rejects local RIAL credit before touching the local repository', async () => {
    await expect(service().credit({ userId: 'u1', currency: 'RIAL', amountMinor: '100', reason: 'test', type: 'trade' })).rejects.toMatchObject({ response: { code: 'RIAL_LEDGER_AUTHORITATIVE_WALLET_SERVICE' } });
  });

  it('rejects local RIAL debit before touching the local repository', async () => {
    await expect(service().debit({ userId: 'u1', currency: 'RIAL', amountMinor: '100', reason: 'test', type: 'trade' })).rejects.toMatchObject({ response: { code: 'RIAL_LEDGER_AUTHORITATIVE_WALLET_SERVICE' } });
  });
});
