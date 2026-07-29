import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';
import { DiscordConfig } from '../config/app.config';
import * as fetch from 'node-fetch';

export class DiscordProvider implements NotificationProvider {
  readonly channel = 'discord' as const;

  constructor(private readonly cfg: DiscordConfig) {}

  async send(n: Notification): Promise<SendResult> {
    try {
      const payload = {
        content: n.subject ? `**${n.subject}**\n${n.body}` : n.body,
        username: 'Rial Bot',
      };
      const res = await fetch(this.cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text();
        return { id: n.id, channel: this.channel, status: 'failed', error: t };
      }
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ id: n.id, error: msg }, 'discord send failed');
      return { id: n.id, channel: this.channel, status: 'failed', error: msg };
    }
  }
}
