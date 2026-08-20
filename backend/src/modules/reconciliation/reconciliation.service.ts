import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DbService } from '../../infrastructure/database/db.service';

export type ReconciliationScope = 'wallet' | 'full';

@Injectable()
export class ReconciliationService {
  constructor(private readonly db: DbService) {}

  async run(scope: ReconciliationScope, initiatedBy: string) {
    const runId = randomUUID();
    const started = new Date();
    await this.db.query(`INSERT INTO operations.reconciliation_runs(id, scope, period_start, period_end, status, initiated_by) VALUES ($1,$2,$3,now(),'running',$4)`, [runId, scope, started, initiatedBy]);
    let findings = 0;
    try {
      const balanceRows = await this.db.query<{
        account_id: string; currency: string; snapshot: string; balance: string; ledger_total: string;
      }>(`
        SELECT a.id::text AS account_id, a.symbol AS currency,
               (a.available + a.pending)::text AS snapshot,
               a.balance::text AS balance,
               COALESCE(SUM(t.amount), 0)::text AS ledger_total
          FROM wallet.accounts a
          LEFT JOIN wallet.transactions t ON t.account_id = a.id
         GROUP BY a.id, a.symbol, a.balance, a.available, a.pending
      `);
      for (const row of balanceRows.rows) {
        const snapshot = BigInt(row.snapshot);
        const balance = BigInt(row.balance);
        const ledgerTotal = BigInt(row.ledger_total);
        if (snapshot === balance && balance === ledgerTotal) continue;
        findings += 1;
        await this.db.query(`INSERT INTO operations.reconciliation_findings(run_id, severity, entity_type, entity_id, expected_value, actual_value, difference) VALUES ($1,'critical','wallet_account',$2,$3::jsonb,$4::jsonb,$5::jsonb)`, [
          runId, row.account_id,
          JSON.stringify({ currency: row.currency, balance: row.balance, ledgerTotal: row.ledger_total }),
          JSON.stringify({ snapshot: row.snapshot }),
          JSON.stringify({ snapshotMinusBalance: (snapshot - balance).toString(), balanceMinusLedger: (balance - ledgerTotal).toString() }),
        ]);
      }
      const status = findings ? 'failed' : 'passed';
      await this.db.query(`UPDATE operations.reconciliation_runs SET status = $1, finished_at = now(), summary = $2::jsonb WHERE id = $3`, [status, JSON.stringify({ findings, accountsChecked: balanceRows.rowCount ?? 0 }), runId]);
      return { id: runId, scope, status, findings, accountsChecked: balanceRows.rowCount ?? 0 };
    } catch (error) {
      await this.db.query(`UPDATE operations.reconciliation_runs SET status = 'failed', finished_at = now(), summary = $1::jsonb WHERE id = $2`, [JSON.stringify({ error: error instanceof Error ? error.message : 'unknown' }), runId]);
      throw error;
    }
  }

  async listOpenFindings(limit = 100) {
    const r = await this.db.query(`SELECT id, run_id AS "runId", severity, entity_type AS "entityType", entity_id AS "entityId", expected_value AS "expectedValue", actual_value AS "actualValue", difference, status, created_at AS "createdAt" FROM operations.reconciliation_findings WHERE status = 'open' ORDER BY created_at DESC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]);
    return r.rows;
  }
}
