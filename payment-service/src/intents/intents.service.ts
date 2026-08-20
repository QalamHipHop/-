// =============================================================================
// IntentsService — orchestrates adapters around durable PostgreSQL intent state
// Author: Qalamhiphop
// =============================================================================
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';
import { randomUUID } from 'node:crypto';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { Money, PaymentError } from '../adapters/types';
import { IntentStore, ListFilter, PaymentRefund } from './intent.store';
import { WalletSettlementClient } from '../settlement/wallet-settlement.client';
import { IntentJSON, IntentKind, IntentStatus, PaymentIntent, intentToJSON } from './intent.entity';

export interface CreateDepositArgs {
  userId: string;
  adapter: string;
  amount: Money;
  reference: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  returnUrl?: string;
}

export interface CreateWithdrawalArgs {
  userId: string;
  adapter: string;
  amount: Money;
  destination: string;
  reference: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

@Injectable()
export class IntentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly registry: AdapterRegistry,
    private readonly store: IntentStore,
    private readonly wallet?: WalletSettlementClient,
  ) {}

  async createDeposit(args: CreateDepositArgs): Promise<IntentJSON> {
    this.assertAmountInRange(args.amount, 'deposit');
    const existing = await this.store.findByIdempotency(args.userId, args.idempotencyKey);
    if (existing) return this.returnExisting(existing, 'deposit');

    const adapter = this.registry.get(args.adapter);
    // Persist before the external PSP call. This is the durable recovery point;
    // the adapter receives the same idempotency key if a reconciler retries it.
    const intent: PaymentIntent = {
      id: 'pi_' + randomUUID(),
      kind: 'deposit',
      userId: args.userId,
      adapter: args.adapter,
      status: 'processing',
      amount: args.amount,
      reference: args.reference,
      idempotencyKey: args.idempotencyKey,
      metadata: args.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const created = await this.store.create(intent);
    if (!created) {
      const winner = await this.store.findByIdempotency(args.userId, args.idempotencyKey);
      if (!winner) throw new Error('PAYMENT_IDEMPOTENCY_LOOKUP_FAILED');
      return this.returnExisting(winner, 'deposit');
    }

    try {
      const res = await adapter.createIntent({
        userId: args.userId,
        kind: 'deposit',
        amount: args.amount,
        reference: args.reference,
        idempotencyKey: args.idempotencyKey,
        metadata: args.metadata ?? {},
        returnUrl: args.returnUrl,
      });
      intent.externalId = res.externalId;
      intent.status = res.status;
      intent.redirectUrl = res.redirectUrl;
      intent.qrCode = res.qrCode;
      intent.expiresAt = res.expiresAt;
    } catch (e) {
      intent.status = 'failed';
      intent.failureReason = (e as Error).message;
    }
    return intentToJSON(await this.store.save(intent));
  }

  async createWithdrawal(args: CreateWithdrawalArgs): Promise<IntentJSON> {
    this.assertAmountInRange(args.amount, 'withdrawal');
    if (!args.destination || args.destination.length < 3) {
      throw new BadRequestException('destination is required');
    }
    const existing = await this.store.findByIdempotency(args.userId, args.idempotencyKey);
    if (existing) return this.returnExisting(existing, 'withdrawal');

    const intent: PaymentIntent = {
      id: 'pi_' + randomUUID(),
      kind: 'withdrawal',
      userId: args.userId,
      adapter: args.adapter,
      status: 'pending',
      amount: args.amount,
      reference: args.reference,
      destination: args.destination,
      idempotencyKey: args.idempotencyKey,
      metadata: args.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const created = await this.store.create(intent);
    if (!created) {
      const winner = await this.store.findByIdempotency(args.userId, args.idempotencyKey);
      if (!winner) throw new Error('PAYMENT_IDEMPOTENCY_LOOKUP_FAILED');
      return this.returnExisting(winner, 'withdrawal');
    }
    return intentToJSON(intent);
  }

  async refund(id: string, userId: string, amount: Money | undefined, reason: string, idempotencyKey: string): Promise<PaymentRefund> {
    const intent = await this.store.get(id);
    if (!intent) throw new NotFoundException('intent not found: ' + id);
    if (intent.userId !== userId) throw new BadRequestException('intent does not belong to user');
    if (intent.kind !== 'deposit' || intent.status !== 'succeeded') throw new BadRequestException('only succeeded deposits can be refunded');
    const refundAmount = amount ?? intent.settledAmount ?? intent.amount;
    if (refundAmount.currency !== intent.amount.currency || refundAmount.amountMinor <= 0n || refundAmount.amountMinor > (intent.settledAmount ?? intent.amount).amountMinor) {
      throw new BadRequestException('refund amount is invalid');
    }
    const existing = await this.store.findRefundByIdempotency(userId, idempotencyKey);
    if (existing) return existing;
    const refund: PaymentRefund = { id: 'rf_' + randomUUID(), intentId: id, userId, amountMinor: refundAmount.amountMinor, currency: refundAmount.currency, idempotencyKey, status: 'requested', reason };
    const created = await this.store.createRefund(refund);
    if (!created) {
      const winner = await this.store.findRefundByIdempotency(userId, idempotencyKey);
      if (!winner) throw new Error('PAYMENT_REFUND_IDEMPOTENCY_LOOKUP_FAILED');
      return winner;
    }
    const adapter = this.registry.get(intent.adapter);
    if (!adapter.refund || !intent.externalId) {
      created.status = 'failed';
      created.failureReason = 'REFUND_UNSUPPORTED_BY_ADAPTER';
      return this.store.saveRefund(created);
    }
    created.status = 'processing';
    await this.store.saveRefund(created);
    try {
      const result = await adapter.refund(intent.externalId, refundAmount, reason, idempotencyKey);
      created.externalId = result.externalId;
      created.status = result.status === 'succeeded' ? 'succeeded' : result.status === 'failed' ? 'failed' : 'processing';
      created.failureReason = result.failureReason;
      if (created.status === 'succeeded') { intent.status = 'refunded'; await this.store.save(intent); }
    } catch (e) {
      created.status = 'failed';
      created.failureReason = (e as Error).message;
    }
    return this.store.saveRefund(created);
  }

  async listRefunds(id: string, userId: string): Promise<PaymentRefund[]> {
    const intent = await this.store.get(id);
    if (!intent || intent.userId !== userId) throw new NotFoundException('intent not found: ' + id);
    return this.store.listRefunds(id);
  }

  async get(id: string): Promise<IntentJSON> {
    const it = await this.store.get(id);
    if (!it) throw new NotFoundException('intent not found: ' + id);
    return intentToJSON(it);
  }

  async list(f: ListFilter): Promise<{ items: IntentJSON[]; total: number }> {
    const r = await this.store.list(f);
    return { items: r.items.map(intentToJSON), total: r.total };
  }

  async cancel(id: string, reason?: string): Promise<IntentJSON> {
    const it = await this.store.get(id);
    if (!it) throw new NotFoundException('intent not found: ' + id);
    if (it.status === 'succeeded' || it.status === 'failed' || it.status === 'cancelled') {
      throw new BadRequestException('cannot cancel intent in status ' + it.status);
    }
    if (it.externalId) {
      const adapter = this.registry.get(it.adapter);
      await adapter.cancel(it.externalId, reason).catch((e: Error) => {
        throw new PaymentError('CANCEL_FAILED', e.message, true);
      });
    }
    it.status = 'cancelled';
    it.failureReason = reason;
    return intentToJSON(await this.store.save(it));
  }

  async applyVerifyResult(id: string, status: IntentStatus, settledAmount?: Money, reason?: string): Promise<IntentJSON | null> {
    let it = await this.store.get(id);
    if (!it) return null;

    // Provider callbacks can arrive out of order. A terminal intent must not be
    // reopened by an older webhook, and a duplicate succeeded callback must not
    // call the settlement boundary again unnecessarily.
    if (it.status === 'refunded') return intentToJSON(it);
    if (it.status === 'succeeded' && status !== 'succeeded') return intentToJSON(it);
    if ((it.status === 'failed' || it.status === 'cancelled' || it.status === 'expired') && status !== it.status) {
      return intentToJSON(it);
    }
    const alreadySucceeded = it.status === 'succeeded';
    if (settledAmount) it.settledAmount = settledAmount;
    if (reason && !alreadySucceeded) it.failureReason = reason;

    // Provider success is durable before the wallet boundary is attempted.
    // A wallet outage must become retryable settlement state, never a lost deposit.
    if (status === 'succeeded' && it.kind === 'deposit') {
      if (alreadySucceeded && it.settlementStatus === 'succeeded') return intentToJSON(it);
      const money = this.toRialSettlement(settledAmount ?? it.settledAmount ?? it.amount);
      if (!alreadySucceeded) {
        it.status = 'succeeded';
        if (settledAmount) it.settledAmount = settledAmount;
        const saved = await this.store.save(it);
        await this.store.markSettlementPending(saved.id);
        it = saved;
      }
      if (!this.wallet) {
        await this.store.markSettlementFailed(it.id, 'WALLET_SETTLEMENT_UNAVAILABLE');
        return intentToJSON(it);
      }
      try {
        const txId = await this.wallet.creditDeposit({
          userId: it.userId,
          amountMinor: money.amountMinor,
          currency: money.currency,
          reference: it.reference,
          idempotencyKey: `payment-deposit:${it.id}`,
          metadata: { intentId: it.id, externalId: it.externalId ?? null, adapter: it.adapter },
        });
        await this.store.markSettlementSucceeded(it.id, txId);
      } catch (error) {
        await this.store.markSettlementFailed(it.id, error instanceof Error ? error.message : String(error));
      }
      return intentToJSON((await this.store.get(it.id)) ?? it);
    }
    it.status = status;
    return intentToJSON(await this.store.save(it));
  }

  async retryPendingSettlements(limit = 50): Promise<number> {
    if (!this.wallet) return 0;
    const pending = await this.store.listSettlementRecovery(limit);
    let completed = 0;
    for (const it of pending) {
      const claimToken = `settlement-recovery:${randomUUID()}`;
      if (!(await this.store.claimSettlement(it.id, claimToken, 300))) continue;
      let money: Money;
      try { money = this.toRialSettlement(it.settledAmount ?? it.amount); }
      catch (error) {
        await this.store.markSettlementFailed(it.id, error instanceof Error ? error.message : String(error), claimToken);
        continue;
      }
      try {
        const txId = await this.wallet.creditDeposit({
          userId: it.userId,
          amountMinor: money.amountMinor,
          currency: money.currency,
          reference: it.reference,
          idempotencyKey: `payment-deposit:${it.id}`,
          metadata: { intentId: it.id, externalId: it.externalId ?? null, adapter: it.adapter, recovery: true },
        });
        if (await this.store.markSettlementSucceeded(it.id, txId, claimToken)) {
          completed += 1;
        }
      } catch (error) {
        await this.store.markSettlementFailed(it.id, error instanceof Error ? error.message : String(error), claimToken);
      }
    }
    return completed;
  }

  async findByExternalId(adapter: string, externalId: string): Promise<PaymentIntent | undefined> {
    return this.store.findByExternalId(adapter, externalId);
  }

  private returnExisting(existing: PaymentIntent, expectedKind: IntentKind): IntentJSON {
    if (existing.kind !== expectedKind) {
      throw new BadRequestException(`idempotency key already used for a ${existing.kind}`);
    }
    return intentToJSON(existing);
  }

  /**
   * Fiat intents use whole IRR or IRT units; the wallet ledger uses RIAL with
   * eight decimal places. Conversion is explicit and integer-only: 1 toman =
   * 10 rial, and one internal RIAL major unit = 100,000,000 minor units.
   */
  private toRialSettlement(money: Money): Money {
    if (money.amountMinor <= 0n) throw new PaymentError('INVALID_SETTLEMENT_AMOUNT', 'settled amount must be positive', false);
    const maxLedgerMinor = (1n << 63n) - 1n;
    let amountMinor: bigint;
    if (money.currency === 'RIAL') amountMinor = money.amountMinor;
    else if (money.currency === 'IRR') amountMinor = money.amountMinor * 100_000_000n;
    else if (money.currency === 'IRT') amountMinor = money.amountMinor * 1_000_000_000n;
    else throw new PaymentError('UNSUPPORTED_SETTLEMENT_CURRENCY', `cannot credit ${money.currency} into RIAL wallet`, false);
    if (amountMinor > maxLedgerMinor) throw new PaymentError('INVALID_SETTLEMENT_AMOUNT', 'settled amount exceeds RIAL ledger int64 range', false);
    return { currency: 'RIAL', amountMinor };
  }

  private assertAmountInRange(amount: Money, kind: IntentKind): void {
    if (!amount || amount.amountMinor <= 0n) {
      throw new BadRequestException('amount must be > 0');
    }
    if (!amount.currency || amount.currency.length < 3) {
      throw new BadRequestException('currency is required (ISO-4217)');
    }
    const lim =
      kind === 'deposit'
        ? { min: this.cfg.limits.minDepositMinor, max: this.cfg.limits.maxDepositMinor }
        : { min: this.cfg.limits.minWithdrawMinor, max: this.cfg.limits.maxWithdrawMinor };
    if (amount.amountMinor < lim.min) {
      throw new BadRequestException(`amount below minimum (${lim.min} minor units)`);
    }
    if (amount.amountMinor > lim.max) {
      throw new BadRequestException(`amount above maximum (${lim.max} minor units)`);
    }
  }
}
