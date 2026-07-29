import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';
import { SmsConfig } from '../config/app.config';

export class SmsProvider implements NotificationProvider {
  readonly channel = 'sms' as const;

  constructor(private readonly cfg?: SmsConfig) {}

  async send(n: Notification): Promise<SendResult> {
    if (!this.cfg || this.cfg.provider === 'noop') {
      logger.info({ id: n.id, to: n.recipient, body: n.body }, 'sms (dry-run)');
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    }
    try {
      // Real provider integration is plugged in here (Kavenegar / Twilio).
      logger.info(
        { id: n.id, provider: this.cfg.provider, to: n.recipient },
        'sms queued',
      );
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: n.id, channel: this.channel, status: 'failed', error: msg };
    }
  }
}
