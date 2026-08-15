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

  private toDomain(row: IntentRow): PaymentIntent {
    return {
      id: row.id,
      kind: row.kind,
      userId: row.user_id,
      adapter: row.adapter,
      status: row.status,
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
