/**
 *  User repository — owns the `auth.users`, `auth.identities`,
 *  `auth.user_preferences`, and `auth.kyc_applications` tables.
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
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  password_hash: string | null;
  status: 'active' | 'suspended' | 'banned' | 'pending';
  kyc_level: number;
  country_code: string | null;
  preferences: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface IdentityRow {
  provider: string;
  provider_uid: string;
  meta: Record<string, unknown>;
  created_at: Date;
}

export interface KycApplicationRow {
  id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  full_name: string;
  dob: string;
  country_code: string;
  document_type: string;
  document_number: string;
  selfie_ref: string | null;
  submitted_at: Date;
  reviewed_at: Date | null;
  reviewer_id: string | null;
  rejection_reason: string | null;
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

  async attachIdentity(
    userId: string,
    provider: string,
    providerUid: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO auth.identities (user_id, provider, provider_uid, meta)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (provider, provider_uid) DO NOTHING`,
      [userId, provider, providerUid, JSON.stringify(meta)],
    );
  }

  async detachIdentity(userId: string, provider: string, providerUid: string): Promise<void> {
    await this.db.query(
      `DELETE FROM auth.identities WHERE user_id = $1 AND provider = $2 AND provider_uid = $3`,
      [userId, provider, providerUid],
    );
  }

  async setPasswordHash(userId: string, hash: string): Promise<void> {
    await this.db.query(
      `UPDATE auth.users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [hash, userId],
    );
  }

  async updateStatus(userId: string, status: UserRow['status']): Promise<void> {
    await this.db.query(
      `UPDATE auth.users SET status = $1, updated_at = now() WHERE id = $2`,
      [status, userId],
    );
  }

  async updateProfile(
    userId: string,
    patch: { displayName?: string | null; avatarUrl?: string | null; bio?: string | null; countryCode?: string | null },
  ): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.displayName !== undefined) { sets.push(`display_name = $${i++}`); vals.push(patch.displayName); }
    if (patch.avatarUrl !== undefined)   { sets.push(`avatar_url = $${i++}`);   vals.push(patch.avatarUrl); }
    if (patch.bio !== undefined)         { sets.push(`bio = $${i++}`);          vals.push(patch.bio); }
    if (patch.countryCode !== undefined) { sets.push(`country_code = $${i++}`);  vals.push(patch.countryCode); }
    if (sets.length === 0) return;
    sets.push(`updated_at = now()`);
    vals.push(userId);
    await this.db.query(
      `UPDATE auth.users SET ${sets.join(', ')} WHERE id = $${i}`,
      vals,
    );
  }

  async bumpKyc(userId: string, level: number): Promise<void> {
    await this.db.query(
      `UPDATE auth.users SET kyc_level = GREATEST(kyc_level, $1), updated_at = now() WHERE id = $2`,
      [level, userId],
    );
  }

  // --------------------------------------------------------- preferences

  async getPreferences(userId: string): Promise<Record<string, unknown> | null> {
    const r = await this.db.query<{ preferences: Record<string, unknown> | null }>(
      `SELECT preferences FROM auth.user_preferences WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0]?.preferences ?? null;
  }

  async setPreferences(userId: string, prefs: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO auth.user_preferences (user_id, preferences, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()`,
      [userId, JSON.stringify(prefs)],
    );
  }

  // --------------------------------------------------------- identities

  async listIdentities(userId: string): Promise<IdentityRow[]> {
    const r = await this.db.query<IdentityRow>(
      `SELECT provider, provider_uid, meta, created_at
       FROM auth.identities
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId],
    );
    return r.rows;
  }

  // -------------------------------------------------------------- KYC

  async getKycApplication(userId: string): Promise<KycApplicationRow | null> {
    const r = await this.db.query<KycApplicationRow>(
      `SELECT * FROM auth.kyc_applications
       WHERE user_id = $1
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [userId],
    );
    return r.rows[0] ?? null;
  }

  async createKycApplication(
    userId: string,
    payload: {
      fullName: string; dob: string; countryCode: string;
      documentType: string; documentNumber: string; selfieRef: string | null;
    },
  ): Promise<KycApplicationRow> {
    const id = randomUUID();
    const r = await this.db.query<KycApplicationRow>(
      `INSERT INTO auth.kyc_applications
         (id, user_id, status, full_name, dob, country_code, document_type, document_number, selfie_ref)
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [id, userId, payload.fullName, payload.dob, payload.countryCode,
       payload.documentType, payload.documentNumber, payload.selfieRef],
    );
    return r.rows[0];
  }

  async reviewKycApplication(
    applicationId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    rejectionReason: string | null,
  ): Promise<KycApplicationRow | null> {
    const r = await this.db.query<KycApplicationRow>(
      `UPDATE auth.kyc_applications
         SET status = $1, reviewed_at = now(), reviewer_id = $2, rejection_reason = $3
       WHERE id = $4
       RETURNING *`,
      [decision, reviewerId, rejectionReason, applicationId],
    );
    return r.rows[0] ?? null;
  }

  // ---------------------------------------------------------- tx helper

  async withTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return this.db.withTransaction(fn);
  }
}
