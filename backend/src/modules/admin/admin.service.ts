import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../infrastructure/database/db.service';

export type AdminUserStatus = 'active' | 'suspended' | 'banned' | 'pending';
const BOOLEAN_PLATFORM_SETTINGS = new Set(['trading_paused', 'launchpad_paused', 'withdrawals_paused']);

@Injectable()
export class AdminService {
  constructor(private readonly db: DbService) {}

  async stats() {
    const r = await this.db.query<{
      users: string;
      tokens: string;
      volume24h: string;
      flagged: string;
      openFindings: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM auth.users)::text AS users,
        (SELECT COUNT(*) FROM launchpad.tokens WHERE status IN ('live','graduated'))::text AS tokens,
        (SELECT COALESCE(SUM((price_minor::numeric * amount_minor::numeric) / 100000000), 0)
           FROM trading.trades WHERE created_at >= now() - interval '24 hours')::text AS "volume24h",
        (SELECT COUNT(*) FROM launchpad.tokens WHERE status IN ('paused','rejected'))::text AS flagged,
        (SELECT COUNT(*) FROM operations.reconciliation_findings WHERE status = 'open')::text AS "openFindings"
    `);
    const row = r.rows[0];
    return {
      users: Number(row?.users ?? 0),
      tokens: Number(row?.tokens ?? 0),
      volume24h: Number(row?.volume24h ?? 0),
      flagged: Number(row?.flagged ?? 0),
      openFindings: Number(row?.openFindings ?? 0),
    };
  }

  async flaggedTokens() {
    const r = await this.db.query(`
      SELECT id::text, symbol, status,
             COALESCE(curve_params->>'riskReason', 'Token requires moderation review') AS reason,
             COALESCE((curve_params->>'riskScore')::numeric, 0)::float AS "riskScore",
             created_at AS ts
        FROM launchpad.tokens
       WHERE status IN ('paused','rejected')
       ORDER BY created_at DESC
       LIMIT 200
    `);
    return r.rows;
  }

  async users(opts: { status?: AdminUserStatus; limit?: number; offset?: number } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
    params.push(Math.max(opts.offset ?? 0, 0));
    const r = await this.db.query(`
      SELECT id::text, email, phone, username, status, kyc_level AS "kycLevel",
             country_code AS "countryCode", created_at AS "createdAt"
        FROM auth.users
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return r.rows;
  }

  async setUserStatus(actorId: string, userId: string, status: AdminUserStatus, reason: string) {
    if (!reason?.trim() || reason.trim().length < 5) {
      throw new BadRequestException({ code: 'ADMIN_REASON_REQUIRED', message: 'A meaningful reason is required' });
    }
    const result = await this.db.withTransaction(async (tx) => {
      const before = await tx.query('SELECT id::text, status FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
      if (!before.rows[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
      const updated = await tx.query('UPDATE auth.users SET status = $1 WHERE id = $2 RETURNING id::text, status', [status, userId]);
      await tx.query(`INSERT INTO operations.admin_actions(actor_id, action, target_type, target_id, reason, before_state, after_state)
                      VALUES ($1, $2, 'user', $3, $4, $5::jsonb, $6::jsonb)`, [
        actorId, `user.status.${status}`, userId, reason,
        JSON.stringify(before.rows[0]), JSON.stringify(updated.rows[0]),
      ]);
      return updated.rows[0];
    });
    return result;
  }

  async settings() {
    const r = await this.db.query('SELECT key, value, description, updated_at AS "updatedAt" FROM operations.platform_settings ORDER BY key');
    return r.rows;
  }

  async updateSetting(actorId: string, key: string, value: unknown, reason: string) {
    if (!reason?.trim() || reason.trim().length < 5) throw new BadRequestException({ code: 'ADMIN_REASON_REQUIRED', message: 'A meaningful reason is required' });
    if (!BOOLEAN_PLATFORM_SETTINGS.has(key)) throw new BadRequestException({ code: 'SETTING_NOT_MUTABLE', message: 'This platform setting is not operator-mutable' });
    if (typeof value !== 'boolean') throw new BadRequestException({ code: 'SETTING_VALUE_INVALID', message: 'Emergency pause settings require a boolean value' });
    const before = await this.db.query('SELECT key, value FROM operations.platform_settings WHERE key = $1', [key]);
    if (!before.rows[0]) throw new NotFoundException({ code: 'SETTING_NOT_FOUND', message: 'Setting not found' });
    const updated = await this.db.withTransaction(async (tx) => {
      const r = await tx.query('UPDATE operations.platform_settings SET value = $1::jsonb, updated_by = $2 WHERE key = $3 RETURNING key, value, description, updated_at AS "updatedAt"', [JSON.stringify(value), actorId, key]);
      await tx.query(`INSERT INTO operations.admin_actions(actor_id, action, target_type, target_id, reason, before_state, after_state)
                      VALUES ($1, 'platform.setting.update', 'setting', $2, $3, $4::jsonb, $5::jsonb)`, [actorId, key, reason, JSON.stringify(before.rows[0]), JSON.stringify(r.rows[0])]);
      return r.rows[0];
    });
    return updated;
  }
}
