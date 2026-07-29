/**
 *  WalletService — business logic on top of WalletRepository.
 *  - Atomic double-entry transfers
 *  - Idempotency via client-supplied clientId
 *  - Multi-sig proposal lifecycle
 *  - System accounts are auto-created (treasury / fee / reward)
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { DbService } from '../../infrastructure/database/db.service';
import { EventBusService } from '../events/event-bus.service';
import { WalletRepository } from './wallet.repository';
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
  ) {}

  // ---------------------------------------------------------------------------
  //  Account bootstrap
  // ---------------------------------------------------------------------------
  async ensureUserAccounts(userId: string): Promise<Account> {
    const rial = await this.repo.findAccount('user', userId, 'user', 'RIAL');
    if (rial) return rial;
    return this.repo.createAccount({
      owner_type: 'user',
      owner_id: userId,
      account_type: 'user',
      currency: 'RIAL',
      address: null,
      label: 'Internal Rial',
      meta: {},
    });
  }

  // ---------------------------------------------------------------------------
  //  Read APIs
  // ---------------------------------------------------------------------------
  async getSummary(userId: string): Promise<WalletSummary> {
    const accounts = await this.repo.listUserAccounts(userId);
    return {
      user: { id: userId } as WalletSummary['user'],
      accounts: accounts.map((a) => ({
        ...a,
        total_minor: a.total_minor ?? '0',
      })),
    };
  }

  async getBalance(userId: string, currency: Currency): Promise<{ available: string; pending: string; reserved: string; currency: Currency }> {
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
    return this.repo.listUserTransactions(userId, opts);
  }

  // ---------------------------------------------------------------------------
  //  Atomic transfer
  // ---------------------------------------------------------------------------
  async transfer(input: TransferInput): Promise<TransferResult> {
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
        : await this.repo.ensureSystemAccount('treasury', input.currency);
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
  async credit(input: { userId: string; currency: Currency; amountMinor: string; reason: string; type: 'deposit' | 'reward' | 'launch'; meta?: Record<string, unknown>; clientId?: string; }): Promise<{ txId: string; newBalance: string }> {
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
      if (!acc && input.currency === 'RIAL') acc = await this.ensureUserAccounts(input.userId);
      if (!acc) acc = await this.repo.createAccount({ owner_type: 'user', owner_id: input.userId, account_type: 'user', currency: input.currency, address: null, label: input.currency, meta: {} }, tx);
      // source = system reward/fee/treasury
      const sys = await this.repo.ensureSystemAccount(input.type === 'reward' ? 'reward' : 'treasury', input.currency);
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
  //  Debit (withdraw / fee) — debit only, no destination
  // ---------------------------------------------------------------------------
  async debit(input: { userId: string; currency: Currency; amountMinor: string; reason: string; type: 'withdraw' | 'fee' | 'trade'; meta?: Record<string, unknown>; clientId?: string; }): Promise<{ txId: string; newBalance: string }> {
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
      const sys = await this.repo.ensureSystemAccount('treasury', input.currency);
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
    return this.db.withTransaction(async (tx) => {
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
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
    return this.db.withTransaction(async (tx) => {
      const acc = await this.repo.findAccount('user', input.userId, 'user', input.currency, tx);
      if (!acc) throw new NotFoundException({ code: 'WALLET_ACCOUNT_MISSING', message: 'account not found' });
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
