import { Notification, NotificationProvider, SendResult } from './notifications.types';
import { logger } from '../common/logger';
import { TelegramConfig } from '../config/app.config';
import fetch from 'node-fetch';

export class TelegramProvider implements NotificationProvider {
  readonly channel = 'telegram' as const;
  private readonly apiBase: string;

  constructor(private readonly cfg: TelegramConfig) {
    this.apiBase = `https://api.telegram.org/bot${cfg.botToken}`;
  }

  async send(n: Notification): Promise<SendResult> {
    const chatId = (n.data?.chatId as string) ?? this.cfg.defaultChatId;
    if (!chatId) {
      return {
        id: n.id,
        channel: this.channel,
        status: 'skipped',
        error: 'no chat_id',
      };
    }
    const text = n.subject ? `*${n.subject}*\n${n.body}` : n.body;
    try {
      const res = await fetch(`${this.apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        return { id: n.id, channel: this.channel, status: 'failed', error: t };
      }
      return { id: n.id, channel: this.channel, status: 'sent', sentAt: new Date().toISOString() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ id: n.id, error: msg }, 'telegram send failed');
      return { id: n.id, channel: this.channel, status: 'failed', error: msg };
    }
  }
}
