/**
 * Users service — unit tests with a mocked repository + session service.
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { UserRepository } from '../auth/user.repository';
import { SessionService } from '../auth/session.service';

const baseRow = {
  id: 'u-1',
  email: 'a@b.com',
  phone: null,
  username: 'alpha',
  display_name: 'Alpha',
  avatar_url: null,
  bio: null,
  password_hash: 'x',
  status: 'active' as const,
  kyc_level: 0,
  country_code: 'IR',
  preferences: null,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-01T00:00:00Z'),
};

function makeRepo() {
  return {
    findById: jest.fn().mockResolvedValue(baseRow),
    listIdentities: jest.fn().mockResolvedValue([]),
    updateProfile: jest.fn().mockImplementation(async (_userId, patch) => {
      Object.assign(baseRow, {
        display_name: patch.displayName,
        avatar_url: patch.avatarUrl,
        bio: patch.bio,
        country_code: patch.countryCode,
      });
    }),
    setPreferences: jest.fn().mockResolvedValue(undefined),
    getPreferences: jest.fn().mockResolvedValue(null),
    getKycApplication: jest.fn().mockResolvedValue(null),
    createKycApplication: jest.fn().mockResolvedValue({
      id: 'k-1', user_id: 'u-1', status: 'pending', submitted_at: new Date(),
    }),
    detachIdentity: jest.fn().mockResolvedValue(undefined),
  };
}

function makeSessions() {
  return {
    list: jest.fn().mockResolvedValue([]),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

describe('UsersService', () => {
  let svc: UsersService;
  let repo: ReturnType<typeof makeRepo>;
  let sessions: ReturnType<typeof makeSessions>;

  beforeEach(async () => {
    repo = makeRepo();
    sessions = makeSessions();
    const mod = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: repo },
        { provide: SessionService, useValue: sessions },
      ],
    }).compile();
    svc = mod.get(UsersService);
  });

  describe('profile', () => {
    it('returns public projection without password hash', async () => {
      const p = await svc.profile('u-1');
      expect(p.id).toBe('u-1');
      expect(p.email).toBe('a@b.com');
      expect((p as unknown as { password_hash?: string }).password_hash).toBeUndefined();
    });
    it('throws when user missing', async () => {
      repo.findById.mockResolvedValueOnce(null);
      await expect(svc.profile('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('rejects too-long displayName', async () => {
      await expect(
        svc.updateProfile('u-1', { displayName: 'x'.repeat(65) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects bad country code', async () => {
      await expect(
        svc.updateProfile('u-1', { countryCode: 'IRAN' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('accepts valid patch', async () => {
      const p = await svc.updateProfile('u-1', { displayName: 'New', countryCode: 'DE' });
      expect(p.displayName).toBe('New');
      expect(repo.updateProfile).toHaveBeenCalled();
    });
  });

  describe('preferences', () => {
    it('returns defaults when none stored', async () => {
      const p = await svc.getPreferences('u-1');
      expect(p.theme).toBe('system');
      expect(p.fiat).toBe('USD');
    });
    it('rejects invalid theme', async () => {
      await expect(
        svc.updatePreferences('u-1', { theme: 'neon' as unknown as 'dark' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('merges partial update', async () => {
      repo.getPreferences.mockResolvedValueOnce({ language: 'fa', theme: 'light', fiat: 'EUR' });
      const p = await svc.updatePreferences('u-1', { theme: 'dark' });
      expect(p.language).toBe('fa');
      expect(p.theme).toBe('dark');
      expect(p.fiat).toBe('EUR');
    });
  });

  describe('KYC', () => {
    it('rejects underage', async () => {
      await expect(
        svc.submitKyc('u-1', {
          fullName: 'X Y', dob: '2020-01-01', countryCode: 'IR',
          documentType: 'passport', documentNumber: 'A1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects bad country', async () => {
      await expect(
        svc.submitKyc('u-1', {
          fullName: 'X Y', dob: '1990-01-01', countryCode: 'XX',
          documentType: 'passport', documentNumber: 'A1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects unsupported doc type', async () => {
      await expect(
        svc.submitKyc('u-1', {
          fullName: 'X Y', dob: '1990-01-01', countryCode: 'IR',
          documentType: 'utility_bill', documentNumber: 'A1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects when an application is already pending', async () => {
      repo.getKycApplication.mockResolvedValueOnce({ status: 'pending' });
      await expect(
        svc.submitKyc('u-1', {
          fullName: 'X Y', dob: '1990-01-01', countryCode: 'IR',
          documentType: 'passport', documentNumber: 'A1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
    it('accepts valid application', async () => {
      const out = await svc.submitKyc('u-1', {
        fullName: 'X Y', dob: '1990-01-01', countryCode: 'IR',
        documentType: 'passport', documentNumber: 'A1',
      });
      expect(out.status).toBe('pending');
    });
  });

  describe('identities', () => {
    it('rejects detaching the last identity', async () => {
      repo.listIdentities.mockResolvedValueOnce([{ provider: 'local', provider_uid: 'a', meta: {} }]);
      await expect(svc.detachIdentity('u-1', 'local', 'a')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('allows detach when others exist', async () => {
      repo.listIdentities.mockResolvedValueOnce([
        { provider: 'local', provider_uid: 'a', meta: {} },
        { provider: 'google', provider_uid: 'b', meta: {} },
      ]);
      await expect(svc.detachIdentity('u-1', 'google', 'b')).resolves.toBeUndefined();
    });
  });

  describe('sessions', () => {
    it('revokes a specific session', async () => {
      await svc.revokeSession('u-1', 'j-1');
      expect(sessions.end).toHaveBeenCalledWith('u-1', 'j-1');
    });
    it('revokes all except current', async () => {
      sessions.list.mockResolvedValueOnce([
        { jti: 'j-1', userId: 'u-1', ip: '', userAgent: '', createdAt: '', lastSeen: '', active: true },
        { jti: 'j-2', userId: 'u-1', ip: '', userAgent: '', createdAt: '', lastSeen: '', active: true },
      ]);
      const n = await svc.revokeAllSessions('u-1', 'j-1');
      expect(n).toBe(1);
      expect(sessions.end).toHaveBeenCalledWith('u-1', 'j-2');
      expect(sessions.end).not.toHaveBeenCalledWith('u-1', 'j-1');
    });
  });
});
