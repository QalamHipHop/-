/**
 *  MFA service — TOTP (RFC 6238) using `otpauth`-style URIs.
 *  Note: we implement here using Node's `crypto` to keep zero native deps;
 *  production should swap in `otplib` for the full RFC spec incl. scratch codes.
 */
import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { base32 } from '@scure/base';

import { AuthConfig } from '../../config/auth.config';

@Injectable()
export class MfaService {
  constructor(private readonly config: ConfigService) {}

  /** Generate a fresh TOTP secret (base32, 20 bytes). */
  generateSecret(): { secret: string; otpauthUrl: string } {
    const bytes = randomBytes(20);
    const secret = base32.encode(bytes).replace(/=+$/, '');
    const issuer = encodeURIComponent(this.config.get<AuthConfig>('auth')!.mfa.totpIssuer);
    const account = encodeURIComponent('user');
    const otpauthUrl = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&period=30&digits=6&algorithm=SHA1`;
    return { secret, otpauthUrl };
  }

  verify(secret: string, token: string): boolean {
    if (!/^\d{6}$/.test(token)) return false;
    const window = this.config.get<AuthConfig>('auth')!.mfa.totpWindow;
    const now = Math.floor(Date.now() / 1000);
    for (let i = -window; i <= window; i++) {
      if (this.totp(secret, now + i * 30) === token) return true;
    }
    return false;
  }

  private totp(secret: string, t: number): string {
    const key = base32.decode(secret.toUpperCase());
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(t / 30));
    const hmac = createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
  }

  assertValidOrThrow(secret: string, token: string): void {
    if (!this.verify(secret, token)) {
      throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'Invalid 2FA code' });
    }
  }
}
