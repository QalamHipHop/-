/**
 * MFA service — TOTP enrollment and verification with encrypted-at-rest secrets.
 */
import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { base32 } from '@scure/base';

import { AuthConfig } from '../../config/auth.config';
import { UserRepository } from './user.repository';
import { SecretEnvelopeService } from '../../common/security/secret-envelope.service';
import { SecurityAuditService } from '../../common/security/security-audit.service';

const MAX_CONFIRMATION_ATTEMPTS = 5;

@Injectable()
export class MfaService {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UserRepository,
    private readonly envelope: SecretEnvelopeService,
    private readonly audit: SecurityAuditService,
  ) {}

  /** Generate a fresh TOTP secret (base32, 20 bytes). */
  generateSecret(account = 'user'): { secret: string; otpauthUrl: string } {
    const bytes = randomBytes(20);
    const secret = base32.encode(bytes).replace(/=+$/, '');
    const issuer = encodeURIComponent(this.config.get<AuthConfig>('auth')!.mfa.totpIssuer);
    const encodedAccount = encodeURIComponent(account);
    const otpauthUrl = `otpauth://totp/${issuer}:${encodedAccount}?secret=${secret}&issuer=${issuer}&period=30&digits=6&algorithm=SHA1`;
    return { secret, otpauthUrl };
  }

  async beginEnrollment(userId: string, account: string): Promise<{ otpauthUrl: string; recoveryCodes: string[] }> {
    const generated = this.generateSecret(account);
    const recoveryCodes = Array.from({ length: 10 }, () => this.generateRecoveryCode());
    const hashes = await Promise.all(recoveryCodes.map((code) => this.hashRecoveryCode(code)));
    await this.users.createMfaEnrollment(userId, this.envelope.encrypt(generated.secret), hashes);
    await this.audit.record({
      aggregate: 'user', aggregateId: userId, actor: userId, action: 'mfa.enrollment_started',
      payload: { recoveryCodeCount: recoveryCodes.length },
    });
    return { otpauthUrl: generated.otpauthUrl, recoveryCodes };
  }

  async confirmEnrollment(userId: string, token: string): Promise<void> {
    const enrollment = await this.users.getMfaEnrollment(userId);
    if (!enrollment || enrollment.status !== 'pending') {
      throw new BadRequestException({ code: 'MFA_ENROLLMENT_REQUIRED', message: 'Pending MFA enrollment required' });
    }
    if (enrollment.confirmation_attempts >= MAX_CONFIRMATION_ATTEMPTS) {
      throw new HttpException({ code: 'MFA_CONFIRMATION_LOCKED', message: 'Too many MFA confirmation attempts' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const secret = this.envelope.decrypt(enrollment.secret_envelope);
    if (!this.verify(secret, token)) {
      const attempts = await this.users.incrementMfaConfirmationAttempts(userId);
      await this.audit.record({
        aggregate: 'user', aggregateId: userId, actor: userId, action: 'mfa.enrollment_failed',
        payload: { attempts },
      });
      if (attempts >= MAX_CONFIRMATION_ATTEMPTS) {
        throw new HttpException({ code: 'MFA_CONFIRMATION_LOCKED', message: 'Too many MFA confirmation attempts' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'Invalid 2FA code' });
    }
    await this.users.confirmMfaEnrollment(userId);
    await this.audit.record({ aggregate: 'user', aggregateId: userId, actor: userId, action: 'mfa.enrollment_confirmed' });
  }

  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (!/^[A-F0-9]{16}$/i.test(code)) return false;
    const consumed = await this.users.consumeMfaRecoveryCode(userId, code.toUpperCase());
    await this.audit.record({
      aggregate: 'user', aggregateId: userId, actor: userId,
      action: consumed ? 'mfa.recovery_code_consumed' : 'mfa.recovery_code_failed',
    });
    return consumed;
  }

  async verifyConfirmed(userId: string, token: string): Promise<boolean> {
    const enrollment = await this.users.getMfaEnrollment(userId);
    if (!enrollment || enrollment.status !== 'confirmed') return false;
    return this.verify(this.envelope.decrypt(enrollment.secret_envelope), token);
  }

  async revokeEnrollment(userId: string): Promise<void> {
    await this.users.revokeMfaEnrollment(userId);
    await this.audit.record({ aggregate: 'user', aggregateId: userId, actor: userId, action: 'mfa.revoked' });
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

  assertValidOrThrow(secret: string, token: string): void {
    if (!this.verify(secret, token)) {
      throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'Invalid 2FA code' });
    }
  }

  private generateRecoveryCode(): string {
    return createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 16).toUpperCase();
  }

  private async hashRecoveryCode(code: string): Promise<string> {
    const rounds = this.config.get<AuthConfig>('auth')!.passwordHashRounds;
    return bcrypt.hash(code, rounds);
  }

  private totp(secret: string, t: number): string {
    const key = base32.decode(secret.toUpperCase());
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(Math.floor(t / 30)));
    const hmac = createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
    return String(code % 1_000_000).padStart(6, '0');
  }
}
