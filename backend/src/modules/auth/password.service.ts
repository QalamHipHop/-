import { Injectable, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';

import { AuthConfig } from '../../config/auth.config';

const MIN_LENGTH = 10;
const COMMON = new Set(['password', 'qwerty', '12345678', 'letmein', 'welcome']);

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService) {}

  async hash(plain: string): Promise<string> {
    this.assertStrong(plain);
    const rounds = this.config.get<AuthConfig>('auth')!.passwordHashRounds;
    return bcrypt.hash(plain, rounds);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    if (!plain || !hash) return false;
    return bcrypt.compare(plain, hash);
  }

  assertStrong(plain: string): void {
    if (typeof plain !== 'string' || plain.length < MIN_LENGTH) {
      throw new BadRequestException({ code: 'PASSWORD_TOO_SHORT', message: `Password must be at least ${MIN_LENGTH} chars` });
    }
    if (COMMON.has(plain.toLowerCase())) {
      throw new BadRequestException({ code: 'PASSWORD_TOO_COMMON', message: 'Password is too common' });
    }
    const hasLower = /[a-z]/.test(plain);
    const hasUpper = /[A-Z]/.test(plain);
    const hasDigit = /\d/.test(plain);
    const hasSym = /[^A-Za-z0-9]/.test(plain);
    const classes = [hasLower, hasUpper, hasDigit, hasSym].filter(Boolean).length;
    if (classes < 3) {
      throw new BadRequestException({ code: 'PASSWORD_WEAK', message: 'Password must contain at least 3 of: lower, upper, digit, symbol' });
    }
  }
}
