// =============================================================================
// IntentStore — PostgreSQL-backed payment-intent repository
// Author: Qalamhiphop
// =============================================================================
import { Injectable } from '@nestjs/common';
import { PaymentIntent, IntentKind, IntentStatus } from './intent.entity';
import { PaymentDatabase } from './payment-database.service';

export interface ListFilter {
  userId?: string;
  kind?: IntentKind;
  status?: IntentStatus;
  page: number;
  pageSize: number;
}

export interface ListResult {
  items: PaymentIntent[];
  total: number;
}

export interface PaymentRefund {
  id: string;
  intentId: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  status: 'requested' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  externalId?: string;
  reason: string;
  failureReason?: string;
}

type IntentRow = {
  id: string;
  kind: IntentKind;
  user_id: string;
  adapter: string;
  status: IntentStatus;
  amount_minor: string;
  currency: string;
  settled_amount_minor: string | null;
  settled_currency: string | null;
  reference: string;
  external_id: string | null;
  redirect_url: string | null;
  qr_code: string | null;
  failure_reason: string | null;
  idempotency_key: string;
  metadata: Record<string, string> | null;
  destination: { address?: string } | null;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string | null;
  settlement_status?: 'not_required' | 'pending' | 'succeeded' | 'failed';
  settlement_attempts?: number;
  settlement_next_attempt_at?: Date | string | null;
  settlement_last_error?: string | null;
  settlement_tx_id?: string | null;
  settled_at?: Date | string | null;
  settlement_claim_token?: string | null;
  settlement_claimed_at?: Date | string | null;
};

@Injectable()
export class IntentStore {
  constructor(private readonly db: PaymentDatabase) {}

  /** Inserts exactly once for a user/idempotency key. False means a prior intent exists. */
  async create(intent: PaymentIntent): Promise<boolean> {
    const r = await this.db.query<IntentRow>(
      `INSERT INTO payments.payment_intents
        (id, kind, user_id, adapter, status, amount_minor, currency, reference,
         external_id, redirect_url, qr_code, failure_reason, idempotency_key,
         metadata, destination, expires_at)
       VALUES
        ($1,$2,$3::uuid,$4,$5,$6::bigint,$7,$8,$9,$10,$11,$12,$13,
         $14::jsonb,$15::jsonb,$16)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        intent.id, intent.kind, intent.userId, intent.adapter, intent.status,
        intent.amount.amountMinor.toString(), intent.amount.currency, intent.reference,
        intent.externalId ?? null, intent.redirectUrl ?? null, intent.qrCode ?? null,
        intent.failureReason ?? null, intent.idempotencyKey, JSON.stringify(intent.metadata),
        intent.destination ? JSON.stringify({ address: intent.destination }) : null,
        intent.expiresAt ?? null,
      ],
    );
    return r.rows.length === 1;
  }

  async createRefund(refund: PaymentRefund): Promise<PaymentRefund | null> {
    const r = await this.db.query(`INSERT INTO payments.refunds (id, intent_id, user_id, amount_minor, currency, idempotency_key, status, reason, metadata) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING *`, [refund.id, refund.intentId, refund.userId, refund.amountMinor.toString(), refund.currency, refund.idempotencyKey, refund.status, refund.reason, JSON.stringify({})]);
    return r.rows[0] ? this.toRefund(r.rows[0]) : null;
  }

  async findRefundByIdempotency(userId: string, key: string): Promise<PaymentRefund | undefined> {
    const r = await this.db.query('SELECT * FROM payments.refunds WHERE user_id = $1::uuid AND idempotency_key = $2', [userId, key]);
    return r.rows[0] ? this.toRefund(r.rows[0]) : undefined;
  }

  async saveRefund(refund: PaymentRefund): Promise<PaymentRefund> {
    const r = await this.db.query(`UPDATE payments.refunds SET status=$2, external_id=$3, failure_reason=$4 WHERE id=$1 RETURNING *`, [refund.id, refund.status, refund.externalId ?? null, refund.failureReason ?? null]);
    if (!r.rows[0]) throw new Error(`PAYMENT_REFUND_NOT_FOUND: ${refund.id}`);
    return this.toRefund(r.rows[0]);
  }

  async listRefunds(intentId: string): Promise<PaymentRefund[]> {
    const r = await this.db.query('SELECT * FROM payments.refunds WHERE intent_id = $1 ORDER BY created_at DESC', [intentId]);
    return r.rows.map((row) => this.toRefund(row));
  }

  async markSettlementPending(id: string): Promise<void> {
    await this.db.query(`UPDATE payments.payment_intents
      SET status='succeeded', settlement_status='pending', settlement_last_error=NULL,
          settlement_next_attempt_at=now(), settlement_claim_token=NULL, settlement_claimed_at=NULL
      WHERE id=$1 AND kind='deposit' AND status='succeeded' AND settlement_status <> 'succeeded'`, [id]);
  }

  async markSettlementFailed(id: string, error: string, claimToken?: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE payments.payment_intents
      SET settlement_status='failed', settlement_attempts=settlement_attempts+1,
          settlement_last_error=$2,
          settlement_next_attempt_at=now() + (LEAST(300, POWER(2, LEAST(settlement_attempts + 1, 8))) * interval '1 second'),
          settlement_claim_token=NULL, settlement_claimed_at=NULL
      WHERE id=$1 AND kind='deposit' AND status='succeeded' AND settlement_status <> 'succeeded'
        AND (($3::text IS NULL AND settlement_claim_token IS NULL) OR settlement_claim_token=$3)`, [id, error, claimToken ?? null]);
    return r.rowCount === 1;
  }

  async markSettlementSucceeded(id: string, txId: string, claimToken?: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE payments.payment_intents
      SET settlement_status='succeeded', settlement_tx_id=$2, settled_at=now(), settlement_last_error=NULL,
          settlement_next_attempt_at=NULL, settlement_claim_token=NULL, settlement_claimed_at=NULL
      WHERE id=$1 AND kind='deposit' AND status='succeeded'
        AND (($3::text IS NULL AND settlement_claim_token IS NULL) OR settlement_claim_token=$3)`, [id, txId, claimToken ?? null]);
    return r.rowCount === 1;
  }

  async claimSettlement(id: string, claimToken: string, leaseSeconds = 300): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE payments.payment_intents
          SET settlement_claim_token=$2, settlement_claimed_at=now()
        WHERE id=$1 AND kind='deposit' AND status='succeeded'
          AND settlement_status IN ('pending','failed')
          AND (settlement_claimed_at IS NULL OR settlement_claimed_at < now() - ($3::int * interval '1 second'))
        RETURNING id`,
      [id, claimToken, Math.max(30, Math.min(900, leaseSeconds))],
    );
    return r.rows.length === 1;
  }

  async listSettlementRecovery(limit = 50): Promise<PaymentIntent[]> {
    const r = await this.db.query<IntentRow>(`SELECT * FROM payments.payment_intents
      WHERE kind='deposit' AND status='succeeded' AND settlement_status IN ('pending','failed')
          AND (settlement_next_attempt_at IS NULL OR settlement_next_attempt_at <= now())
          AND (settlement_claimed_at IS NULL OR settlement_claimed_at < now() - interval '5 minutes')
      ORDER BY updated_at ASC LIMIT $1`, [Math.min(Math.max(limit, 1), 200)]);
    return r.rows.map((row) => this.toDomain(row));
  }

  async save(intent: PaymentIntent): Promise<PaymentIntent> {
    const r = await this.db.query<IntentRow>(
      `UPDATE payments.payment_intents
          SET status = $2,
              settled_amount_minor = $3::bigint,
              settled_currency = $4,
              external_id = $5,
              redirect_url = $6,
              qr_code = $7,
              failure_reason = $8,
              metadata = $9::jsonb,
              destination = $10::jsonb,
              expires_at = $11
        WHERE id = $1
        RETURNING *`,
      [
        intent.id, intent.status, intent.settledAmount?.amountMinor.toString() ?? null,
        intent.settledAmount?.currency ?? null, intent.externalId ?? null,
        intent.redirectUrl ?? null, intent.qrCode ?? null, intent.failureReason ?? null,
        JSON.stringify(intent.metadata),
        intent.destination ? JSON.stringify({ address: intent.destination }) : null,
        intent.expiresAt ?? null,
      ],
    );
    if (!r.rows[0]) throw new Error(`PAYMENT_INTENT_NOT_FOUND: ${intent.id}`);
    return this.toDomain(r.rows[0]);
  }

  /** Record a provider event exactly once before applying its state transition. */
  async recordWebhookEvent(event: { id: string; adapter: string; externalId: string; type: string; payload: unknown }): Promise<boolean> {
    const r = await this.db.query(
      `INSERT INTO payments.webhook_events (id, adapter, external_id, type, payload, processing_started_at, processing_attempts)
       VALUES ($1,$2,$3,$4,$5::jsonb,now(),1)
       ON CONFLICT (adapter, external_id, type) DO NOTHING
       RETURNING id`,
      [event.id, event.adapter, event.externalId, event.type, JSON.stringify(event.payload ?? {})],
    );
    return r.rows.length === 1;
  }

  async claimWebhookEvent(adapter: string, externalId: string, type: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE payments.webhook_events
          SET processing_started_at = now(), processing_attempts = processing_attempts + 1
        WHERE adapter=$1 AND external_id=$2 AND type=$3
          AND processed_at IS NULL
          AND (processing_started_at IS NULL OR processing_started_at < now() - interval '5 minutes')
        RETURNING id`,
      [adapter, externalId, type],
    );
    return r.rows.length === 1;
  }

  async markWebhookProcessed(adapter: string, externalId: string, type: string): Promise<void> {
    await this.db.query(
      `UPDATE payments.webhook_events SET processed_at = now()
       WHERE adapter=$1 AND external_id=$2 AND type=$3`,
      [adapter, externalId, type],
    );
  }

  async isWebhookProcessed(adapter: string, externalId: string, type: string): Promise<boolean> {
    const r = await this.db.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM payments.webhook_events
       WHERE adapter=$1 AND external_id=$2 AND type=$3`,
      [adapter, externalId, type],
    );
    return r.rows[0]?.processed_at !== null && r.rows[0]?.processed_at !== undefined;
  }

  async get(id: string): Promise<PaymentIntent | undefined> {
    const r = await this.db.query<IntentRow>('SELECT * FROM payments.payment_intents WHERE id = $1', [id]);
    return r.rows[0] ? this.toDomain(r.rows[0]) : undefined;
  }

  async findByIdempotency(userId: string, key: string): Promise<PaymentIntent | undefined> {
    const r = await this.db.query<IntentRow>(
      'SELECT * FROM payments.payment_intents WHERE user_id = $1::uuid AND idempotency_key = $2',
      [userId, key],
    );
    return r.rows[0] ? this.toDomain(r.rows[0]) : undefined;
  }

  async findByExternalId(adapter: string, externalId: string): Promise<PaymentIntent | undefined> {
    const r = await this.db.query<IntentRow>(
      'SELECT * FROM payments.payment_intents WHERE adapter = $1 AND external_id = $2',
      [adapter, externalId],
    );
    return r.rows[0] ? this.toDomain(r.rows[0]) : undefined;
  }

  async list(f: ListFilter): Promise<ListResult> {
    const where: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    if (f.userId) where.push(`user_id = ${bind(f.userId)}::uuid`);
    if (f.kind) where.push(`kind = ${bind(f.kind)}`);
    if (f.status) where.push(`status = ${bind(f.status)}`);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await this.db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM payments.payment_intents ${clause}`,
      params,
    );
    const limit = Math.min(Math.max(f.pageSize, 1), 200);
    const page = Math.max(f.page, 1);
    const pageParams = [...params, limit, (page - 1) * limit];
    const rows = await this.db.query<IntentRow>(
      `SELECT * FROM payments.payment_intents ${clause}
       ORDER BY created_at DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );
    return { items: rows.rows.map((row) => this.toDomain(row)), total: Number(count.rows[0]?.total ?? '0') };
  }

  private toRefund(row: any): PaymentRefund {
    return { id: row.id, intentId: row.intent_id, userId: row.user_id, amountMinor: BigInt(row.amount_minor), currency: row.currency, idempotencyKey: row.idempotency_key, status: row.status, externalId: row.external_id ?? undefined, reason: row.reason, failureReason: row.failure_reason ?? undefined };
  }

  private toDomain(row: IntentRow): PaymentIntent {
    return {
      id: row.id,
      kind: row.kind,
      userId: row.user_id,
      adapter: row.adapter,
      status: row.status,
      settlementStatus: row.settlement_status ?? undefined,
      amount: { amountMinor: BigInt(row.amount_minor), currency: row.currency },
      settledAmount: row.settled_amount_minor === null
        ? undefined
        : { amountMinor: BigInt(row.settled_amount_minor), currency: row.settled_currency ?? row.currency },
      reference: row.reference,
      externalId: row.external_id ?? undefined,
      redirectUrl: row.redirect_url ?? undefined,
      qrCode: row.qr_code ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata ?? {},
      destination: row.destination?.address,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    };
  }
}
