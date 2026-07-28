/**
 *  User repository — owns the `auth.users` and `auth.identities` tables.
 *  Cross-schema writes always go through this repository; never raw SQL in services.
 */
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';

import { DbService } from '../../infrastructure/database/db.service';

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  password_hash: string | null;
  status: 'active' | 'suspended' | 'banned' | 'pending';
  kyc_level: number;
  country_code: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class UserRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT * FROM auth.users WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT * FROM auth.users WHERE email = $1`, [email.toLowerCase()]);
    return r.rows[0] ?? null;
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT * FROM auth.users WHERE phone = $1`, [phone]);
    return r.rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(`SELECT * FROM auth.users WHERE username = $1`, [username]);
    return r.rows[0] ?? null;
  }

  async findByIdentity(provider: string, providerUid: string): Promise<UserRow | null> {
    const r = await this.db.query<UserRow>(
      `SELECT u.* FROM auth.users u
       JOIN auth.identities i ON i.user_id = u.id
       WHERE i.provider = $1 AND i.provider_uid = $2`,
      [provider, providerUid],
    );
    return r.rows[0] ?? null;
  }

  async createLocal(input: {
    email?: string; phone?: string; username?: string; passwordHash?: string;
  }): Promise<UserRow> {
    const id = randomUUID();
    const r = await this.db.query<UserRow>(
      `INSERT INTO auth.users (id, email, phone, username, password_hash, status, kyc_level)
       VALUES ($1, $2, $3, $4, $5, 'pending', 0)
       RETURNING *`,
      [id, input.email?.toLowerCase() ?? null, input.phone ?? null, input.username ?? null, input.passwordHash ?? null],
    );
    return r.rows[0];
  }

  async attachIdentity(userId: string, provider: string, providerUid: string, meta: Record<string, unknown> = {}): Promise<void> {
    await this.db.query(
      `INSERT INTO auth.identities (user_id, provider, provider_uid, meta)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (provider, provider_uid) DO NOTHING`,
      [userId, provider, providerUid, JSON.stringify(meta)],
    );
  }

  async setPasswordHash(userId: string, hash: string): Promise<void> {
    await this.db.query(`UPDATE auth.users SET password_hash = $1, updated_at = now() WHERE id = $2`, [hash, userId]);
  }

  async updateStatus(userId: string, status: UserRow['status']): Promise<void> {
    await this.db.query(`UPDATE auth.users SET status = $1, updated_at = now() WHERE id = $2`, [status, userId]);
  }

  async bumpKyc(userId: string, level: number): Promise<void> {
    await this.db.query(
      `UPDATE auth.users SET kyc_level = GREATEST(kyc_level, $1), updated_at = now() WHERE id = $2`,
      [level, userId],
    );
  }

  async listIdentities(userId: string): Promise<Array<{ provider: string; provider_uid: string; meta: Record<string, unknown> }>> {
    const r = await this.db.query<{ provider: string; provider_uid: string; meta: Record<string, unknown> }>(
      `SELECT provider, provider_uid, meta FROM auth.identities WHERE user_id = $1`,
      [userId],
    );
    return r.rows;
  }

  async withTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }
}
