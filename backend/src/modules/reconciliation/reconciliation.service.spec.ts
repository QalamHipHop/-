import { ReconciliationService } from './reconciliation.service';

describe('ReconciliationService', () => {
  it('passes when every balance snapshot equals its ledger total', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ account_id: 'a', currency: 'RIAL', snapshot: '10', balance: '10', ledger_total: '10' }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const service = new ReconciliationService(db as never);
    const result = await service.run('wallet', 'admin-1');
    expect(result.status).toBe('passed');
    expect(result.findings).toBe(0);
    expect(db.query).toHaveBeenCalled();
  });

  it('records a critical finding when the snapshot diverges from ledger', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ account_id: 'a', currency: 'RIAL', snapshot: '12', balance: '12', ledger_total: '10' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) };
    const service = new ReconciliationService(db as never);
    const result = await service.run('wallet', 'admin-1');
    expect(result.status).toBe('failed');
    expect(result.findings).toBe(1);
  });
});
