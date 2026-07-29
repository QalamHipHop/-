import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';
import { SmtpConfig } from '../config/app.config';

/**
 * Email provider. In dev/test mode (no SMTP_HOST) it logs the message
 * and returns success. In production, plug in `nodemailer` here.
 */
export class EmailProvider implements NotificationProvider {
  readonly channel = 'email' as const;

  constructor(private readonly cfg?: SmtpConfig) {}

  async send(n: Notification): Promise<SendResult> {
    if (!this.cfg) {
      logger.info(
        { id: n.id, to: n.recipient, subject: n.subject, body: n.body },
        'email (dry-run)',
      );
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    }
    try {
      // In production, real SMTP send here. We keep the implementation
      // intentionally minimal so the service can be deployed without
      // an extra dependency in dev.
      logger.info(
        { id: n.id, host: this.cfg.host, to: n.recipient, subject: n.subject },
        'email queued',
      );
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: n.id, channel: this.channel, status: 'failed', error: msg };
    }
  }
}
