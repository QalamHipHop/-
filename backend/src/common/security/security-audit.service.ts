import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

import { DbService } from '../../infrastructure/database/db.service';

export interface SecurityAuditEvent {
  aggregate: string;
  aggregateId: string;
  actor: string;
  action: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class SecurityAuditService {
  constructor(private readonly db: DbService) {}

  async record(event: SecurityAuditEvent): Promise<void> {
    const payload = event.payload ?? {};
    const payloadJson = JSON.stringify(payload);
    const payloadHash = createHash('sha256').update(payloadJson).digest();

    await this.db.withTransaction(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('rial.security.audit'))`);
      const previous = await tx.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM shared.audit ORDER BY id DESC LIMIT 1`,
      );
      await tx.query(
        `INSERT INTO shared.audit (aggregate, aggregate_id, actor, action, payload, payload_hash, prev_hash)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
        [
          event.aggregate,
          event.aggregateId,
          event.actor,
          event.action,
          payloadJson,
          payloadHash,
          previous.rows[0]?.payload_hash ?? null,
        ],
      );
    });
  }
}
