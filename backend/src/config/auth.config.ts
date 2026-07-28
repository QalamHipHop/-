import { registerAs } from '@nestjs/config';

export interface AuthConfig {
  jwt: {
    secret: string;
    accessTtl: number;   // seconds
    refreshTtl: number;  // seconds
    issuer: string;
    audience: string;
    algorithm: 'HS256' | 'HS384' | 'HS512' | 'RS256';
  };
  passwordHashRounds: number;
  session: {
    cookieName: string;
    cookieSecure: boolean;
    cookieSameSite: 'strict' | 'lax' | 'none';
  };
  mfa: {
    totpIssuer: string;
    totpWindow: number;
  };
  rateLimit: { failedLoginPer15Min: number };
}

export const authConfig = registerAs('auth', (): AuthConfig => {
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return {
    jwt: {
      secret: secret || 'dev-only-insecure-secret-change-me',
      accessTtl: Number(process.env.JWT_ACCESS_TTL ?? 900),       // 15 min
      refreshTtl: Number(process.env.JWT_REFRESH_TTL ?? 60 * 60 * 24 * 14), // 14 days
      issuer: process.env.JWT_ISSUER ?? 'rial-platform',
      audience: process.env.JWT_AUDIENCE ?? 'rial-api',
      algorithm: (process.env.JWT_ALG as AuthConfig['jwt']['algorithm']) ?? 'HS256',
    },
    passwordHashRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),
    session: {
      cookieName: process.env.SESSION_COOKIE_NAME ?? 'rial_session',
      cookieSecure: (process.env.SESSION_COOKIE_SECURE ?? 'true') === 'true',
      cookieSameSite: (process.env.SESSION_COOKIE_SAMESITE as AuthConfig['session']['cookieSameSite']) ?? 'lax',
    },
    mfa: {
      totpIssuer: process.env.TOTP_ISSUER ?? 'RIAL',
      totpWindow: Number(process.env.TOTP_WINDOW ?? 1),
    },
    rateLimit: {
      failedLoginPer15Min: Number(process.env.FAILED_LOGIN_LIMIT ?? 5),
    },
  };
});
