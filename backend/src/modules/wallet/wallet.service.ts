/**
 *  WalletService — business logic on top of WalletRepository.
 *  - Atomic double-entry transfers
 *  - Idempotency via client-supplied clientId
 *  - Multi-sig proposal lifecycle
 *  - System accounts are auto-created (treasury / fee / reward)
 */
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { DbService } from '../../infrastructure/database/db.service';
import { EventBusService } from '../events/event-bus.service';
import { WalletRepository } from './wallet.repository';
import { RialLedgerClient } from './rial-ledger.client';
import type {
  Account,
  Balance,
  Currency,
  LockInput,
  MultiSigProposal,
  TransferInput,
  TransferResult,
  UnlockInput,
  WalletSummary,
} from './wallet.types';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: WalletRepository,
    private readonly events: EventBusService,
    private readonly rialLedger: RialLedgerClient,
  ) {}

  private assertLocalCurrency(currency: Currency): void {
    if (currency === 'RIAL') throw new BadGatewayException({ code: 'RIAL_LEDGER_AUTHORITATIVE_WALLET_SERVICE' });
  }

  // ---------------------------------------------------------------------------
  //  Account bootstrap
  // ---------------------------------------------------------------------------
  async ensureUserAccounts(userId: string): Promise<Account> {
    throw new BadGatewayException({ code: 'RIAL_LEDGER_AUTHORITATIVE_WALLET_SERVICE', userId });
  }

  // ---------------------------------------------------------------------------
  //  Read APIs
  // ---------------------------------------------------------------------------
  async getSummary(userId: string): Promise<WalletSummary> {
    const [accounts, rial] = await Promise.all([this.repo.listUserAccounts(userId), this.rialLedger.account(userId)]);
    const tokenAccounts = accounts.filter((a) => a.currency !== 'RIAL');
    const rialAccount = {
      id: rial.accountId,
      account_id: rial.accountId,
      owner_type: 'user' as const,
      owner_id: userId,
      account_type: 'user' as const,
      currency: 'RIAL',
      address: null,
      label: 'Authoritative RIAL',
      meta: { ledgerAuthority: 'wallet-service' },
      created_at: new Date(0),
      updated_at: new Date(),
      available_minor: rial.available,
      pending_minor: rial.pending,
      reserved_minor: rial.reserved,
      total_minor: (BigInt(rial.available) + BigInt(rial.pending) + BigInt(rial.reserved)).toString(),
    };
    return { user: { id: userId } as WalletSummary['user'], accounts: [rialAccount, ...tokenAccounts.map((a) => ({ ...a, total_minor: a.total_minor ?? '0' }))] };
  }

  async getBalance(userId: string, currency: Currency): Promise<{ available: string; pending: string; reserved: string; currency: Currency }> {
    if (currency === 'RIAL') {
      const balance = await this.rialLedger.account(userId);
      return { available: balance.available, pending: balance.pending, reserved: balance.reserved, currency: 'RIAL' };
    }
    let account = await this.repo.findAccount('user', userId, 'user', currency);
    if (!account && currency === 'RIAL') account = await this.ensureUserAccounts(userId);
    if (!account) return { available: '0', pending: '0', reserved: '0', currency };
    const b = await this.repo.getBalance(account.id);
    return {
      available: b?.available_minor ?? '0',
      pending: b?.pending_minor ?? '0',
      reserved: b?.reserved_minor ?? '0',
      currency,
    };
  }

  async listTransactions(userId: string, opts: { limit?: number; type?: 'deposit' | 'withdraw' | 'trade' | 'launch' | 'fee' | 'reward' | 'transfer' }) {
    const [rial, local] = await Promise.all([
      this.rialLedger.transactions(userId, opts.limit),
      this.repo.listUserTransactions(userId, opts),
    ]);
    const tokenOnly = local.filter((tx) => tx.currency !== 'RIAL');
    return [...(rial as any[]), ...tokenOnly];
  }

  async settleRialTrade(input: { buyerId: string; sellerId: string; notional: string; buyerFee: string; sellerFee: string; tradeId: string; meta?: Record<string, unknown> }) {
    return this.rialLedger.settleTrade({ buyerId: input.buyerId, sellerId: input.sellerId, notional: input.notional, buyerFee: input.buyerFee, sellerFee: input.sellerFee, reference: input.tradeId, idempotencyKey: `trade:${input.tradeId}:rial`, metadata: input.meta });
  }

  // ---------------------------------------------------------------------------
  //  Atomic transfer
  // ---------------------------------------------------------------------------
  async transfer(input: TransferInput): Promise<TransferResult> {
    this.assertLocalCurrency(input.currency);
    if (BigInt(input.amountMinor) <= 0n) {
      throw new BadRequestException({ code: 'WALLET_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    }
    return this.db.withTransaction(async (tx) => {
      // Idempotency
      if (input.clientId) {
        const existing = await tx.query(
          `SELECT * FROM wallets.transactions WHERE user_id = $1 AND meta->>'clientId' = $2 LIMIT 1`,
          [input.userId, input.clientId],
        );
        if (existing.rows[0]) {
          return existing.rows[0] as TransferResult;
        }
      }

      // Resolve source & destination
      const from = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!from) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'source account not found' });
      const to = input.toUserId
        ? await this.repo.findAccount('user', input.toUserId, 'user', input.currency, tx)
        : await this.repo.ensureSystemAccount('treasury', input.currency, undefined, tx);
      if (!to) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'destination account not found' });

      // Move money + write ledger entries
      const newFromBal = await this.repo.adjustAvailable(from.id, `-${input.amountMinor}`, tx);
      const newToBal = await this.repo.adjustAvailable(to.id, input.amountMinor, tx);
      const txId = randomUUID();
      await this.repo.writeLedgerEntries(
        txId,
        [
          { account_id: from.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: input.reason, meta: input.meta },
          { account_id: to.id,   amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: input.reason, meta: input.meta },
        ],
        tx,
      );

      const metaHash = createHash('sha256').update(JSON.stringify(input.meta ?? {})).digest('hex');
      await this.repo.recordTransaction(
        {
          id: txId,
          user_id: input.userId,
          type: input.toUserId ? 'transfer' : 'fee',
          currency: input.currency,
          amount_minor: `-${input.amountMinor}`,
          status: 'completed',
          meta: { ...(input.meta ?? {}), clientId: input.clientId, metaHash, toUserId: input.toUserId ?? null, toAccountId: to.id },
        },
        tx,
      );

      await this.db.txOutbox(tx, {
        aggregate: 'wallet',
        aggregateId: txId,
        eventType: 'wallet.transfer.completed',
        payload: { txId, from: from.id, to: to.id, currency: input.currency, amountMinor: input.amountMinor, reason: input.reason },
      });

      void this.events.publish('wallet.transfer.completed', {
        txId, fromAccountId: from.id, toAccountId: to.id, currency: input.currency, amountMinor: input.amountMinor,
      }).catch((e) => this.logger.warn(`event publish failed: ${(e as Error).message}`));

      return {
        txId,
        fromAccountId: from.id,
        toAccountId: to.id,
        amountMinor: input.amountMinor,
        newFromBalance: newFromBal.available_minor,
        newToBalance: newToBal.available_minor,
      };
    });
  }

  // ---------------------------------------------------------------------------
  //  Credit (deposit / mint / reward) — credit only, no source
  // ---------------------------------------------------------------------------
  async credit(input: { userId: string; currency: Currency; amountMinor: string; reason: string; type: 'deposit' | 'reward' | 'launch' | 'trade'; meta?: Record<string, unknown>; clientId?: string; }): Promise<{ txId: string; newBalance: string }> {
    this.assertLocalCurrency(input.currency);
    if (BigInt(input.amountMinor) <= 0n) {
      throw new BadRequestException({ code: 'WALLET_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    }
    return this.db.withTransaction(async (tx) => {
      if (input.clientId) {
        const existing = await tx.query(
          `SELECT * FROM wallets.transactions WHERE user_id = $1 AND meta->>'clientId' = $2 LIMIT 1`,
          [input.userId, input.clientId],
        );
        if (existing.rows[0]) {
          return { txId: existing.rows[0].id, newBalance: '0' };
        }
      }
      let acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) acc = await this.repo.createAccount({ owner_type: 'user', owner_id: input.userId, account_type: 'user', currency: input.currency, address: null, label: input.currency, meta: {} }, tx);
      // source = system reward/fee/treasury
      const sys = await this.repo.ensureSystemAccount(input.type === 'reward' ? 'reward' : 'treasury', input.currency, undefined, tx);
      const newBal = await this.repo.adjustAvailable(acc.id, input.amountMinor, tx);
      await this.repo.adjustAvailable(sys.id, `-${input.amountMinor}`, tx);
      const txId = randomUUID();
      await this.repo.writeLedgerEntries(txId, [
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: input.reason, meta: input.meta },
        { account_id: sys.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: input.reason, meta: input.meta },
      ], tx);
      await this.repo.recordTransaction({
        id: txId, user_id: input.userId, type: input.type, currency: input.currency,
        amount_minor: input.amountMinor, status: 'completed',
        meta: { ...(input.meta ?? {}), clientId: input.clientId },
      }, tx);
      await this.db.txOutbox(tx, {
        aggregate: 'wallet', aggregateId: txId, eventType: 'wallet.credit.completed',
        payload: { txId, userId: input.userId, currency: input.currency, amountMinor: input.amountMinor, reason: input.reason, type: input.type },
      });
      return { txId, newBalance: newBal.available_minor };
    });
  }

  // ---------------------------------------------------------------------------
  //  Withdrawal request — reserve funds until custody confirms broadcast
  // ---------------------------------------------------------------------------
  async requestWithdrawal(input: { userId: string; currency: Currency; amountMinor: string; destination: string; memo?: string; clientId: string; }): Promise<{ txId: string; status: 'pending'; newBalance: string }> {
    this.assertLocalCurrency(input.currency);
    if (BigInt(input.amountMinor) <= 0n) throw new BadRequestException({ code: 'WALLET_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    return this.db.withTransaction(async (tx) => {
      const prior = await tx.query(`SELECT id, status FROM wallets.transactions WHERE user_id = $1 AND meta->>'clientId' = $2 LIMIT 1`, [input.userId, input.clientId]);
      if (prior.rows[0]) {
        const account = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
        const balance = account ? await this.repo.getBalance(account.id, tx) : null;
        return { txId: prior.rows[0].id, status: 'pending' as const, newBalance: balance?.available_minor ?? '0' };
      }
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
      const balance = await this.repo.moveAvailableToReserved(acc.id, input.amountMinor, tx);
      const txId = randomUUID();
      const meta = { destination: input.destination, memo: input.memo, clientId: input.clientId };
      await this.repo.writeLedgerEntries(txId, [
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: 'withdrawal.reserve', meta },
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: 'withdrawal.reserved', meta },
      ], tx);
      await this.repo.recordTransaction({ id: txId, user_id: input.userId, type: 'withdraw', currency: input.currency, amount_minor: `-${input.amountMinor}`, status: 'pending', meta }, tx);
      await this.db.txOutbox(tx, { aggregate: 'wallet', aggregateId: txId, eventType: 'wallet.withdrawal.requested', payload: { txId, userId: input.userId, currency: input.currency, amountMinor: input.amountMinor, destination: input.destination, memo: input.memo, clientId: input.clientId } });
      return { txId, status: 'pending' as const, newBalance: balance.available_minor };
    });
  }

  // ---------------------------------------------------------------------------
  //  Debit (withdraw / fee) — debit only, no destination
  // ---------------------------------------------------------------------------
  async debit(input: { userId: string; currency: Currency; amountMinor: string; reason: string; type: 'withdraw' | 'fee' | 'trade'; meta?: Record<string, unknown>; clientId?: string; }): Promise<{ txId: string; newBalance: string }> {
    this.assertLocalCurrency(input.currency);
    if (BigInt(input.amountMinor) <= 0n) {
      throw new BadRequestException({ code: 'WALLET_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    }
    return this.db.withTransaction(async (tx) => {
      if (input.clientId) {
        const existing = await tx.query(
          `SELECT * FROM wallets.transactions WHERE user_id = $1 AND meta->>'clientId' = $2 LIMIT 1`,
          [input.userId, input.clientId],
        );
        if (existing.rows[0]) {
          return { txId: existing.rows[0].id, newBalance: '0' };
        }
      }
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
      const sys = await this.repo.ensureSystemAccount('treasury', input.currency, undefined, tx);
      const newBal = await this.repo.adjustAvailable(acc.id, `-${input.amountMinor}`, tx);
      await this.repo.adjustAvailable(sys.id, input.amountMinor, tx);
      const txId = randomUUID();
      await this.repo.writeLedgerEntries(txId, [
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: input.reason, meta: input.meta },
        { account_id: sys.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: input.reason, meta: input.meta },
      ], tx);
      await this.repo.recordTransaction({
        id: txId, user_id: input.userId, type: input.type, currency: input.currency,
        amount_minor: `-${input.amountMinor}`, status: 'completed',
        meta: { ...(input.meta ?? {}), clientId: input.clientId },
      }, tx);
      await this.db.txOutbox(tx, {
        aggregate: 'wallet', aggregateId: txId, eventType: 'wallet.debit.completed',
        payload: { txId, userId: input.userId, currency: input.currency, amountMinor: input.amountMinor, reason: input.reason, type: input.type },
      });
      return { txId, newBalance: newBal.available_minor };
    });
  }

  // ---------------------------------------------------------------------------
  //  Lock / unlock (escrow)
  // ---------------------------------------------------------------------------
  async lock(input: LockInput): Promise<{ ok: true; balance: Balance }> {
    if (input.currency === 'RIAL') {
      if (!input.refId) throw new BadRequestException({ code: 'RIAL_LOCK_REFERENCE_REQUIRED' });
      const account = await this.rialLedger.account(input.userId);
      await this.rialLedger.reserve(input.userId, input.amountMinor, input.reason, `reserve:${input.refId}`, { reason: input.reason });
      const after = await this.rialLedger.account(input.userId);
      return { ok: true, balance: { account_id: account.accountId, available_minor: after.available, pending_minor: after.pending, reserved_minor: '0', updated_at: new Date() } };
    }
    return this.db.withTransaction(async (tx) => {
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
      if (input.refId) {
        const prior = await tx.query('SELECT 1 FROM wallets.ledger_entries WHERE account_id = $1 AND reason = $2 AND meta->>\'refId\' = $3 LIMIT 1', [acc.id, 'lock', input.refId]);
        if (prior.rows[0]) return { ok: true, balance: (await this.repo.getBalance(acc.id, tx))! };
      }
      const b = await this.repo.moveAvailableToReserved(acc.id, input.amountMinor, tx);
      const txId = randomUUID();
      await this.repo.writeLedgerEntries(txId, [
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: 'lock', meta: { refId: input.refId } },
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: 'reserved', meta: { refId: input.refId } },
      ], tx);
      await this.db.txOutbox(tx, {
        aggregate: 'wallet', aggregateId: txId, eventType: 'wallet.lock',
        payload: { txId, userId: input.userId, currency: input.currency, amountMinor: input.amountMinor, reason: input.reason, refId: input.refId },
      });
      return { ok: true, balance: b };
    });
  }

  async unlock(input: UnlockInput): Promise<{ ok: true; balance: Balance }> {
    if (input.currency === 'RIAL') {
      if (!input.refId) throw new BadRequestException({ code: 'RIAL_UNLOCK_REFERENCE_REQUIRED' });
      const account = await this.rialLedger.account(input.userId);
      await this.rialLedger.release(input.userId, input.amountMinor, input.reason, `release:${input.refId}`, { reason: input.reason });
      const after = await this.rialLedger.account(input.userId);
      return { ok: true, balance: { account_id: account.accountId, available_minor: after.available, pending_minor: after.pending, reserved_minor: '0', updated_at: new Date() } };
    }
    return this.db.withTransaction(async (tx) => {
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
      if (input.refId) {
        const prior = await tx.query('SELECT 1 FROM wallets.ledger_entries WHERE account_id = $1 AND reason = $2 AND meta->>\'refId\' = $3 LIMIT 1', [acc.id, 'unlock', input.refId]);
        if (prior.rows[0]) return { ok: true, balance: (await this.repo.getBalance(acc.id, tx))! };
      }
      const b = await this.repo.moveReservedToAvailable(acc.id, input.amountMinor, tx);
      const txId = randomUUID();
      await this.repo.writeLedgerEntries(txId, [
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'debit', reason: 'unlock', meta: { refId: input.refId } },
        { account_id: acc.id, amount_minor: input.amountMinor, currency: input.currency, kind: 'credit', reason: 'available', meta: { refId: input.refId } },
      ], tx);
      await this.db.txOutbox(tx, {
        aggregate: 'wallet', aggregateId: txId, eventType: 'wallet.unlock',
        payload: { txId, userId: input.userId, currency: input.currency, amountMinor: input.amountMinor, reason: input.reason, refId: input.refId },
      });
      return { ok: true, balance: b };
    });
  }

  // ---------------------------------------------------------------------------
  //  Multi-sig proposals
  // ---------------------------------------------------------------------------
  async createProposal(input: { chain: string; toAddress: string; amountMinor: string; currency: Currency; data?: Buffer; threshold: number; createdBy: string; ttlSeconds?: number; }): Promise<MultiSigProposal> {
    const expiresAt = input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null;
    return this.db.withTransaction(async (tx) => {
      const p = await this.repo.createMultisigProposal({
        chain: input.chain,
        to_address: input.toAddress,
        amount_minor: input.amountMinor,
        currency: input.currency,
        data: input.data ?? null,
        threshold: input.threshold,
        created_by: input.createdBy,
        expires_at: expiresAt,
      }, tx);
      await this.db.txOutbox(tx, {
        aggregate: 'multisig', aggregateId: p.id, eventType: 'multisig.proposal.created',
        payload: { proposal: p },
      });
      return p;
    });
  }

  async signProposal(proposalId: string, signer: string, signature: Buffer): Promise<{ status: MultiSigProposal['status']; thresholdMet: boolean }> {
    return this.db.withTransaction(async (tx) => {
      const p = await tx.query<MultiSigProposal>(`SELECT * FROM wallets.multisig_proposals WHERE id = $1`, [proposalId]);
      if (!p.rows[0]) throw new NotFoundException({ code: 'MULTISIG_NOT_FOUND', message: 'proposal not found' });
      const proposal = p.rows[0];
      if (proposal.status !== 'pending') {
        return { status: proposal.status, thresholdMet: proposal.status === 'signed' || proposal.status === 'broadcast' };
      }
      const count = await this.repo.addMultisigSignature(proposalId, signer, signature, tx);
      let status: MultiSigProposal['status'] = 'pending';
      let thresholdMet = false;
      if (count >= proposal.threshold) {
        status = 'signed';
        thresholdMet = true;
        await this.repo.setMultisigStatus(proposalId, 'signed', tx);
      }
      await this.db.txOutbox(tx, {
        aggregate: 'multisig', aggregateId: proposalId, eventType: 'multisig.signed',
        payload: { proposalId, signer, count, threshold: proposal.threshold, status },
      });
      return { status, thresholdMet };
    });
  }

  async listProposals(opts?: { status?: MultiSigProposal['status'] }) {
    return this.repo.listMultisigProposals(opts);
  }
}
