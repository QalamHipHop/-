// =============================================================================
//  IntentsService — orchestrates adapter calls, persists intents, exposes state
//  Author: QalamCode
// =============================================================================
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../config/payment-config.module';
import { AppConfig } from '../config/configuration';
import { randomUUID } from 'node:crypto';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { Money, PaymentError } from '../adapters/types';
import { CreateIntentInput } from '../adapters/adapter.interface';
import { IntentStore, ListFilter } from './intent.store';
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
  ) {}

  async createDeposit(args: CreateDepositArgs): Promise<IntentJSON> {
    this.assertAmountInRange(args.amount, 'deposit');
    const existing = this.store.findByIdempotency(args.userId, args.idempotencyKey);
    if (existing) {
      if (existing.kind !== 'deposit') {
        throw new BadRequestException('idempotency key already used for a withdrawal');
      }
      return intentToJSON(existing);
    }
    const adapter = this.registry.get(args.adapter);
    const intent: PaymentIntent = {
      id: 'pi_' + randomUUID(),
      kind: 'deposit',
      userId: args.userId,
      adapter: args.adapter,
      status: 'pending',
      amount: args.amount,
      reference: args.reference,
      idempotencyKey: args.idempotencyKey,
      metadata: args.metadata ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
    this.store.save(intent);
    return intentToJSON(intent);
  }

  async createWithdrawal(args: CreateWithdrawalArgs): Promise<IntentJSON> {
    this.assertAmountInRange(args.amount, 'withdrawal');
    if (!args.destination || args.destination.length < 3) {
      throw new BadRequestException('destination is required');
    }
    const existing = this.store.findByIdempotency(args.userId, args.idempotencyKey);
    if (existing) {
      if (existing.kind !== 'withdrawal') {
        throw new BadRequestException('idempotency key already used for a deposit');
      }
      return intentToJSON(existing);
    }
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
    // For withdrawals the adapter is contacted only after risk/AML review
    // (out of scope for this service) — here we just mark as pending and
    // emit a webhook when the operator confirms.
    this.store.save(intent);
    return intentToJSON(intent);
  }

  get(id: string): IntentJSON {
    const it = this.store.get(id);
    if (!it) throw new NotFoundException('intent not found: ' + id);
    return intentToJSON(it);
  }

  list(f: ListFilter): { items: IntentJSON[]; total: number } {
    const r = this.store.list(f);
    return { items: r.items.map(intentToJSON), total: r.total };
  }

  async cancel(id: string, reason?: string): Promise<IntentJSON> {
    const it = this.store.get(id);
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
    it.updatedAt = new Date();
    this.store.save(it);
    return intentToJSON(it);
  }

  applyVerifyResult(id: string, status: IntentStatus, settledAmount?: Money, reason?: string): IntentJSON | null {
    const it = this.store.get(id);
    if (!it) return null;
    it.status = status;
    it.updatedAt = new Date();
    if (settledAmount) it.settledAmount = settledAmount;
    if (reason) it.failureReason = reason;
    this.store.save(it);
    return intentToJSON(it);
  }

  findByExternalId(adapter: string, externalId: string): PaymentIntent | undefined {
    for (const set of this.store['byUser'].values()) {
      for (const id of set) {
        const it = this.store.get(id);
        if (it && it.adapter === adapter && it.externalId === externalId) return it;
      }
    }
    return undefined;
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
