/**
 *  WalletRepository — owns all SQL for accounts / balances / ledger / transactions.
 *  Returns plain rows; never throws for "not found" (returns null).
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

type Queryable = { query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: T[] }> };
import { DbService } from '../../infrastructure/database/db.service';
import type { Account, Balance, Transaction, AccountType, Currency, MultiSigProposal } from './wallet.types';

@Injectable()
export class WalletRepository {
  constructor(private readonly db: DbService) {}

  private client(c?: PoolClient): Queryable {
    return (c ?? this.db) as Queryable;
  }

  async findAccount(
    ownerType: 'user' | 'service',
    ownerId: string,
    accountType: AccountType,
    currency: Currency,
    c?: PoolClient,
  ): Promise<Account | null> {
    const r = await this.client(c).query<Account>(
      `SELECT * FROM wallets.accounts
        WHERE owner_type = $1 AND owner_id = $2 AND account_type = $3 AND currency = $4
        LIMIT 1`,
      [ownerType, ownerId, accountType, currency],
    );
    return r.rows[0] ?? null;
  }

  async findAccountById(id: string, c?: PoolClient): Promise<Account | null> {
    const r = await this.client(c).query<Account>('SELECT * FROM wallets.accounts WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async createAccount(input: Omit<Account, 'id' | 'created_at' | 'updated_at'>, c?: PoolClient): Promise<Account> {
    const r = await this.client(c).query<Account>(
      `INSERT INTO wallets.accounts (owner_type, owner_id, account_type, currency, address, label, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [input.owner_type, input.owner_id, input.account_type, input.currency, input.address, input.label, JSON.stringify(input.meta ?? {})],
    );
    // initialize a 0 balance row
    await this.client(c).query(
      `INSERT INTO wallets.balances (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`,
      [r.rows[0].id],
    );
    return r.rows[0];
  }

  async listUserAccounts(userId: string): Promise<Array<Account & Balance & { total_minor: string }>> {
    const r = await this.client().query<Account & Balance & { total_minor: string }>(
      `SELECT a.*,
              b.available_minor::text, b.pending_minor::text, b.reserved_minor::text,
              b.updated_at AS b_updated_at,
              (b.available_minor + b.pending_minor + b.reserved_minor)::text AS total_minor
         FROM wallets.accounts a
         LEFT JOIN wallets.balances b ON b.account_id = a.id
        WHERE a.owner_type = 'user' AND a.owner_id = $1
        ORDER BY a.created_at ASC`,
      [userId],
    );
    return r.rows;
  }

  async getBalance(accountId: string, c?: PoolClient): Promise<Balance | null> {
    const r = await this.client(c).query<Balance>(
      `SELECT account_id, available_minor::text, pending_minor::text, reserved_minor::text, updated_at
         FROM wallets.balances WHERE account_id = $1`,
      [accountId],
    );
    return r.rows[0] ?? null;
  }

  /** Adjusts available balance by a signed delta. Returns new balance row. */
  async adjustAvailable(
    accountId: string,
    deltaMinor: string,
    c?: PoolClient,
  ): Promise<Balance> {
    const r = await this.client(c).query<Balance>(
      `UPDATE wallets.balances
          SET available_minor = available_minor + $1::bigint,
              updated_at = now()
        WHERE account_id = $2
          AND available_minor + $1::bigint >= 0
        RETURNING account_id, available_minor::text, pending_minor::text, reserved_minor::text, updated_at`,
      [deltaMinor, accountId],
    );
    if (!r.rows[0]) throw new Error('INSUFFICIENT_AVAILABLE');
    return r.rows[0];
  }

  async moveAvailableToReserved(accountId: string, amountMinor: string, c?: PoolClient): Promise<Balance> {
    const r = await this.client(c).query<Balance>(
      `UPDATE wallets.balances
          SET available_minor = available_minor - $1::bigint,
              reserved_minor  = reserved_minor  + $1::bigint,
              updated_at = now()
        WHERE account_id = $2 AND available_minor >= $1::bigint
        RETURNING account_id, available_minor::text, pending_minor::text, reserved_minor::text, updated_at`,
      [amountMinor, accountId],
    );
    if (!r.rows[0]) throw new Error('INSUFFICIENT_AVAILABLE');
    return r.rows[0];
  }

  async moveReservedToAvailable(accountId: string, amountMinor: string, c?: PoolClient): Promise<Balance> {
    const r = await this.client(c).query<Balance>(
      `UPDATE wallets.balances
          SET reserved_minor  = reserved_minor  - $1::bigint,
              available_minor = available_minor + $1::bigint,
              updated_at = now()
        WHERE account_id = $2 AND reserved_minor >= $1::bigint
        RETURNING account_id, available_minor::text, pending_minor::text, reserved_minor::text, updated_at`,
      [amountMinor, accountId],
    );
    if (!r.rows[0]) throw new Error('INSUFFICIENT_RESERVED');
    return r.rows[0];
  }

  async writeLedgerEntries(
    txId: string,
    entries: Array<{ account_id: string; amount_minor: string; currency: Currency; kind: 'debit' | 'credit'; reason: string; meta?: Record<string, unknown> }>,
    c: PoolClient,
  ): Promise<void> {
    if (entries.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const e of entries) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}::jsonb)`);
      params.push(txId, e.account_id, e.amount_minor, e.currency, e.kind, e.reason, JSON.stringify(e.meta ?? {}));
    }
    await c.query(
      `INSERT INTO wallets.ledger_entries
        (tx_id, account_id, amount_minor, currency, kind, reason, meta)
       VALUES ${values.join(',')}`,
      params,
    );
  }

  async recordTransaction(input: Omit<Transaction, 'created_at'>, c?: PoolClient): Promise<Transaction> {
    const r = await this.client(c).query<Transaction>(
      `INSERT INTO wallets.transactions (id, user_id, type, currency, amount_minor, status, meta)
       VALUES ($1, $2, $3, $4, $5::bigint, $6, $7::jsonb)
       RETURNING *`,
      [input.id, input.user_id, input.type, input.currency, input.amount_minor, input.status, JSON.stringify(input.meta ?? {})],
    );
    return r.rows[0];
  }

  async listUserTransactions(userId: string, opts: { limit?: number; cursor?: string; type?: Transaction['type'] } = {}): Promise<Transaction[]> {
    const params: unknown[] = [userId];
    let where = 'user_id = $1';
    if (opts.type) { params.push(opts.type); where += ` AND type = $${params.length}`; }
    params.push(opts.limit ?? 50);
    const r = await this.client().query<Transaction>(
      `SELECT * FROM wallets.transactions WHERE ${where}
        ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows;
  }

  async createMultisigProposal(input: Omit<MultiSigProposal, 'id' | 'status' | 'created_at'>, c?: PoolClient): Promise<MultiSigProposal> {
    const r = await this.client(c).query<MultiSigProposal>(
      `INSERT INTO wallets.multisig_proposals (chain, to_address, amount_minor, currency, data, threshold, created_by, expires_at)
       VALUES ($1, $2, $3::bigint, $4, $5, $6, $7, $8) RETURNING *`,
      [input.chain, input.to_address, input.amount_minor, input.currency, input.data, input.threshold, input.created_by, input.expires_at],
    );
    return r.rows[0];
  }

  async listMultisigProposals(opts: { status?: MultiSigProposal['status'] } = {}): Promise<MultiSigProposal[]> {
    const params: unknown[] = [];
    let where = '1=1';
    if (opts.status) { params.push(opts.status); where += ` AND status = $${params.length}`; }
    const r = await this.client().query<MultiSigProposal>(
      `SELECT * FROM wallets.multisig_proposals WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return r.rows;
  }

  async addMultisigSignature(proposalId: string, signer: string, signature: Buffer, c?: PoolClient): Promise<number> {
    await this.client(c).query(
      `INSERT INTO wallets.multisig_signatures (proposal_id, signer, signature) VALUES ($1, $2, $3)
       ON CONFLICT (proposal_id, signer) DO NOTHING`,
      [proposalId, signer, signature],
    );
    const r = await this.client(c).query<{ count: string; threshold: number }>(
      `SELECT (SELECT count(*) FROM wallets.multisig_signatures WHERE proposal_id = $1) AS count,
              threshold FROM wallets.multisig_proposals WHERE id = $1`,
      [proposalId],
    );
    return Number(r.rows[0]?.count ?? '0');
  }

  async setMultisigStatus(id: string, status: MultiSigProposal['status'], c?: PoolClient): Promise<void> {
    await this.client(c).query(
      `UPDATE wallets.multisig_proposals SET status = $1 WHERE id = $2`,
      [status, id],
    );
  }

  /** Treasury / fee / reward special accounts (created on demand). */
  async ensureSystemAccount(accountType: AccountType, currency: Currency, label?: string): Promise<Account> {
    const existing = await this.findAccount('service', `system:${accountType}`, accountType, currency);
    if (existing) return existing;
    return this.createAccount({
      owner_type: 'service',
      owner_id: `system:${accountType}`,
      account_type: accountType,
      currency,
      address: null,
      label: label ?? `System ${accountType} (${currency})`,
      meta: { system: true },
    });
  }
}

export type WalletRepo = WalletRepository;
// keep TS happy
export type _Row = QueryResultRow;
