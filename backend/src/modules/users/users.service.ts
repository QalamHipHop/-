/**
 *  Users service — profile, KYC, preferences, device/session management.
 *  Owns everything outside credential issuance (which lives in AuthService).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { UserRepository } from '../auth/user.repository';
import { SessionService } from '../auth/session.service';

export interface PublicProfile {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  status: 'active' | 'suspended' | 'banned' | 'pending';
  kycLevel: number;
  countryCode: string | null;
  createdAt: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  language: string;
  theme: 'light' | 'dark' | 'system';
  fiat: string;
  notifications: {
    email: boolean;
    sms: boolean;
    push: boolean;
    telegram: boolean;
  };
  privacy: {
    showPortfolio: boolean;
    showActivity: boolean;
  };
}

const DEFAULT_PREFERENCES: UserPreferences = {
  language: 'en',
  theme: 'system',
  fiat: 'USD',
  notifications: { email: true, sms: false, push: true, telegram: false },
  privacy: { showPortfolio: true, showActivity: true },
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionService,
  ) {}

  // -------------------------------------------------------------- profile

  async profile(userId: string): Promise<PublicProfile> {
    const row = await this.users.findById(userId);
    if (!row) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    return this.toPublicProfile(row);
  }

  async updateProfile(
    userId: string,
    patch: {
      displayName?: string;
      avatarUrl?: string;
      bio?: string;
      countryCode?: string;
    },
  ): Promise<PublicProfile> {
    if (patch.displayName !== undefined && patch.displayName.length > 64) {
      throw new BadRequestException({ code: 'PROFILE_NAME_TOO_LONG', message: 'displayName > 64 chars' });
    }
    if (patch.bio !== undefined && patch.bio.length > 512) {
      throw new BadRequestException({ code: 'PROFILE_BIO_TOO_LONG', message: 'bio > 512 chars' });
    }
    if (patch.countryCode !== undefined && !/^[A-Z]{2}$/.test(patch.countryCode)) {
      throw new BadRequestException({ code: 'PROFILE_COUNTRY_INVALID', message: 'countryCode must be ISO-3166 alpha-2' });
    }

    await this.users.updateProfile(userId, {
      displayName: patch.displayName ?? null,
      avatarUrl: patch.avatarUrl ?? null,
      bio: patch.bio ?? null,
      countryCode: patch.countryCode ?? null,
    });
    return this.profile(userId);
  }

  // ---------------------------------------------------------- preferences

  async getPreferences(userId: string): Promise<UserPreferences> {
    const row = await this.users.getPreferences(userId);
    return this.mergePreferences(row);
  }

  async updatePreferences(userId: string, prefs: Partial<UserPreferences>): Promise<UserPreferences> {
    const merged = { ...(await this.getPreferences(userId)), ...prefs };
    if (merged.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(merged.language)) {
      throw new BadRequestException({ code: 'PREF_LANG_INVALID', message: 'invalid language tag' });
    }
    if (!['light', 'dark', 'system'].includes(merged.theme)) {
      throw new BadRequestException({ code: 'PREF_THEME_INVALID', message: 'theme must be light|dark|system' });
    }
    if (merged.fiat && !/^[A-Z]{3}$/.test(merged.fiat)) {
      throw new BadRequestException({ code: 'PREF_FIAT_INVALID', message: 'fiat must be ISO-4217 alpha-3' });
    }
    await this.users.setPreferences(userId, merged);
    return merged;
  }

  // ------------------------------------------------------------- KYC flow

  /** Submit KYC payload. The provider is async — we just record the intent. */
  async submitKyc(
    userId: string,
    payload: { fullName: string; dob: string; countryCode: string; documentType: string; documentNumber: string; selfieRef?: string },
  ): Promise<{ status: 'pending' | 'approved' | 'rejected'; level: number }> {
    if (!/^[A-Z]{2}$/.test(payload.countryCode)) {
      throw new BadRequestException({ code: 'KYC_COUNTRY_INVALID', message: 'invalid country' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dob)) {
      throw new BadRequestException({ code: 'KYC_DOB_INVALID', message: 'dob must be YYYY-MM-DD' });
    }
    const age = this.ageFromDob(payload.dob);
    if (age < 18) {
      throw new BadRequestException({ code: 'KYC_UNDERAGE', message: 'must be 18+' });
    }
    if (!['passport', 'national_id', 'driver_license'].includes(payload.documentType)) {
      throw new BadRequestException({ code: 'KYC_DOC_TYPE_INVALID', message: 'unsupported document type' });
    }

    const existing = await this.users.getKycApplication(userId);
    if (existing && existing.status === 'pending') {
      throw new ConflictException({ code: 'KYC_ALREADY_PENDING', message: 'a KYC application is already pending' });
    }

    const submission = await this.users.createKycApplication(userId, {
      fullName: payload.fullName,
      dob: payload.dob,
      countryCode: payload.countryCode,
      documentType: payload.documentType,
      documentNumber: payload.documentNumber,
      selfieRef: payload.selfieRef ?? null,
    });

    // Sync level from prior (max 1 until provider approves)
    const profile = await this.users.findById(userId);
    return { status: submission.status, level: profile?.kyc_level ?? 0 };
  }

  async kycStatus(userId: string) {
    const app = await this.users.getKycApplication(userId);
    const profile = await this.users.findById(userId);
    return {
      level: profile?.kyc_level ?? 0,
      status: app?.status ?? 'none',
      submittedAt: app?.submitted_at ?? null,
      reviewedAt: app?.reviewed_at ?? null,
      rejectionReason: app?.rejection_reason ?? null,
    };
  }

  // ---------------------------------------------------------- identities

  async listIdentities(userId: string) {
    return this.users.listIdentities(userId);
  }

  async detachIdentity(userId: string, provider: string, providerUid: string): Promise<void> {
    const all = await this.users.listIdentities(userId);
    if (all.length <= 1) {
      throw new BadRequestException({ code: 'IDENTITY_LAST', message: 'cannot detach last identity' });
    }
    await this.users.detachIdentity(userId, provider, providerUid);
  }

  // ---------------------------------------------------------- sessions

  async listSessions(userId: string) {
    return this.sessions.list(userId);
  }

  async revokeSession(userId: string, jti: string): Promise<void> {
    await this.sessions.end(userId, jti);
  }

  async revokeAllSessions(userId: string, exceptJti?: string): Promise<number> {
    const sessions = await this.sessions.list(userId);
    let n = 0;
    for (const s of sessions) {
      if (s.jti === exceptJti) continue;
      await this.sessions.end(userId, s.jti);
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------- helpers

  private toPublicProfile(row: Awaited<ReturnType<UserRepository['findById']>>): PublicProfile {
    if (!row) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      username: row.username,
      displayName: row.display_name ?? null,
      avatarUrl: row.avatar_url ?? null,
      bio: row.bio ?? null,
      status: row.status,
      kycLevel: row.kyc_level,
      countryCode: row.country_code,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      preferences: this.mergePreferences(row.preferences),
    };
  }

  private mergePreferences(raw: unknown): UserPreferences {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES };
    const r = raw as Partial<UserPreferences>;
    return {
      language: r.language ?? DEFAULT_PREFERENCES.language,
      theme: (r.theme as UserPreferences['theme']) ?? DEFAULT_PREFERENCES.theme,
      fiat: r.fiat ?? DEFAULT_PREFERENCES.fiat,
      notifications: { ...DEFAULT_PREFERENCES.notifications, ...(r.notifications ?? {}) },
      privacy: { ...DEFAULT_PREFERENCES.privacy, ...(r.privacy ?? {}) },
    };
  }

  private ageFromDob(dob: string): number {
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return age;
  }
}
