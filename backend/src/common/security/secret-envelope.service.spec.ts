import { ConfigService } from '@nestjs/config';

import { SecretEnvelopeService } from './secret-envelope.service';

describe('SecretEnvelopeService', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const service = new SecretEnvelopeService({ get: () => key } as unknown as ConfigService);

  it('round-trips a secret without storing plaintext in the envelope', () => {
    const envelope = service.encrypt('TOTP-SECRET-123');
    expect(envelope).toMatch(/^v1:/);
    expect(envelope).not.toContain('TOTP-SECRET-123');
    expect(service.decrypt(envelope)).toBe('TOTP-SECRET-123');
  });

  it('rejects tampered ciphertext', () => {
    const envelope = service.encrypt('TOTP-SECRET-123');
    const parts = envelope.split(':');
    parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;
    expect(() => service.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects invalid key length', () => {
    const invalid = new SecretEnvelopeService({ get: () => Buffer.alloc(16).toString('base64') } as unknown as ConfigService);
    expect(() => invalid.encrypt('secret')).toThrow('MFA_ENCRYPTION_KEY must be base64-encoded 32 bytes');
  });
});
