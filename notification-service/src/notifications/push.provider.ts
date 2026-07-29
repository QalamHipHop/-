import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';
import { WebPushConfig } from '../config/app.config';

export class PushProvider implements NotificationProvider {
  readonly channel = 'push' as const;

  constructor(private readonly cfg?: WebPushConfig) {}

  async send(n: Notification): Promise<SendResult> {
    if (!this.cfg) {
      logger.info({ id: n.id, to: n.recipient, subject: n.subject }, 'push (dry-run)');
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    }
    // Real `web-push` integration plugs in here. Keys are present
    // intentionally so the config can be validated.
    logger.info({ id: n.id, to: n.recipient }, 'push queued');
    return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
  }
}
