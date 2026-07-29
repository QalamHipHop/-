import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';

/**
 * Inbox = the platform's own in-app notification stream. We don't
 * persist here (the user service owns that), we just acknowledge
 * the message was handed off successfully.
 */
export class InboxProvider implements NotificationProvider {
  readonly channel = 'inbox' as const;

  async send(n: Notification): Promise<SendResult> {
    logger.info(
      { id: n.id, to: n.recipient, subject: n.subject, correlationId: n.correlationId },
      'inbox accepted',
    );
    return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
  }
}
