import { BadRequestException, UnauthorizedException } from '@nestjs/common';

jest.mock('@scure/base', () => ({
  base32: { encode: jest.fn(), decode: jest.fn() },
}));

import { AuthService } from './auth.service';

describe('AuthService.changePassword', () => {
  const user = {
    id: 'user-1',
    email: 'user@example.test',
    phone: null,
    username: 'user',
    display_name: null,
    avatar_url: null,
    bio: null,
    password_hash: 'old-hash',
    status: 'active' as const,
    kyc_level: 0,
    country_code: null,
    preferences: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  function makeService() {
    const users = {
      findById: jest.fn().mockResolvedValue(user),
      setPasswordHash: jest.fn().mockResolvedValue(undefined),
    };
    const password = {
      verify: jest.fn().mockResolvedValue(true),
      hash: jest.fn().mockResolvedValue('new-hash'),
    };
    const tokens = { revokeAll: jest.fn().mockResolvedValue(2) };
    const service = new AuthService(
      users as any,
      password as any,
      tokens as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, users, password, tokens };
  }

  it('verifies, replaces the hash, and revokes all refresh sessions', async () => {
    const { service, users, password, tokens } = makeService();

    await service.changePassword('user-1', 'OldPassword!1', 'NewPassword!2');

    expect(users.findById).toHaveBeenCalledWith('user-1');
    expect(password.verify).toHaveBeenCalledWith('OldPassword!1', 'old-hash');
    expect(password.hash).toHaveBeenCalledWith('NewPassword!2');
    expect(users.setPasswordHash).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(tokens.revokeAll).toHaveBeenCalledWith('user-1');
  });

  it('rejects an invalid current password without changing credentials', async () => {
    const { service, users, password, tokens } = makeService();
    password.verify.mockResolvedValue(false);

    await expect(service.changePassword('user-1', 'wrong-password', 'NewPassword!2')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.setPasswordHash).not.toHaveBeenCalled();
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });

  it('rejects reuse of the current password', async () => {
    const { service, users, password, tokens } = makeService();

    await expect(service.changePassword('user-1', 'SamePassword!1', 'SamePassword!1')).rejects.toBeInstanceOf(BadRequestException);
    expect(password.hash).not.toHaveBeenCalled();
    expect(users.setPasswordHash).not.toHaveBeenCalled();
    expect(tokens.revokeAll).not.toHaveBeenCalled();
  });
});

describe('AuthService.login MFA enforcement', () => {
  const user = {
    id: 'user-1', email: 'user@example.test', phone: null, username: 'user', display_name: null,
    avatar_url: null, bio: null, password_hash: 'hash', status: 'active' as const, kyc_level: 0,
    country_code: null, preferences: null, created_at: new Date(), updated_at: new Date(),
  };

  function makeLoginService(enrollment: { status: 'confirmed' | 'pending' } | null, mfaValid = true) {
    const users = {
      findByUsername: jest.fn().mockResolvedValue(user),
      getMfaEnrollment: jest.fn().mockResolvedValue(enrollment),
    };
    const password = { verify: jest.fn().mockResolvedValue(true) };
    const tokens = { issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', accessExpiresIn: 1, refreshExpiresIn: 2, tokenType: 'Bearer' }) };
    const sessions = { start: jest.fn().mockResolvedValue(undefined) };
    const mfa = { verifyConfirmed: jest.fn().mockResolvedValue(mfaValid), verifyRecoveryCode: jest.fn().mockResolvedValue(false) };
    const redis = {
      get: jest.fn().mockResolvedValue('0'),
      del: jest.fn().mockResolvedValue(1),
      multi: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }),
    };
    const config = { get: jest.fn().mockReturnValue({ jwt: { refreshTtl: 3600 }, rateLimit: { failedLoginPer15Min: 5 } }) };
    const service = new AuthService(users as any, password as any, tokens as any, sessions as any, mfa as any, config as any, redis as any);
    return { service, users, tokens, sessions, mfa };
  }

  it('does not issue tokens when confirmed MFA is missing', async () => {
    const { service, tokens, mfa } = makeLoginService({ status: 'confirmed' });
    await expect(service.login({ identifier: 'user', password: 'Password!1', ip: '127.0.0.1', userAgent: 'test' })).rejects.toMatchObject({ response: { code: 'MFA_REQUIRED' } });
    expect(mfa.verifyConfirmed).not.toHaveBeenCalled();
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('issues tokens only after confirmed MFA validates', async () => {
    const { service, tokens, sessions, mfa } = makeLoginService({ status: 'confirmed' }, true);
    await service.login({ identifier: 'user', password: 'Password!1', mfaCode: '123456', ip: '127.0.0.1', userAgent: 'test' });
    expect(mfa.verifyConfirmed).toHaveBeenCalledWith('user-1', '123456');
    expect(tokens.issue).toHaveBeenCalled();
    expect(sessions.start).toHaveBeenCalled();
  });
});
