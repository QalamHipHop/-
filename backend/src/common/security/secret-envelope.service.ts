import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

@Injectable()
export class SecretEnvelopeService {
  constructor(private readonly config: ConfigService) {}

  encrypt(plaintext: string): string {
    if (!plaintext) throw new BadRequestException({ code: 'SECRET_EMPTY', message: 'Secret cannot be empty' });
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
  }

  decrypt(envelope: string): string {
    const [version, ivText, tagText, ciphertextText] = envelope.split(':');
    if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
      throw new BadRequestException({ code: 'SECRET_ENVELOPE_INVALID', message: 'Invalid secret envelope' });
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key(), Buffer.from(ivText, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new BadRequestException({ code: 'SECRET_DECRYPT_FAILED', message: 'Secret could not be decrypted' });
    }
  }

  private key(): Buffer {
    const encoded = this.config.get<string>('auth.mfaEncryptionKey') ?? process.env.MFA_ENCRYPTION_KEY;
    if (!encoded) throw new Error('MFA_ENCRYPTION_KEY is required for secret operations');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be base64-encoded 32 bytes');
    return key;
  }
}
