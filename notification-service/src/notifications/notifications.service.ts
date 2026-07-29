import { Injectable, OnModuleInit } from '@nestjs/common';
import { v4 as uuid } from 'uuid';

import { IdempotencyCache } from '../common/idempotency';
import { logger } from '../common/logger';
import { AppConfig } from '../config/app.config';
import { DiscordProvider } from './discord.provider';
import { EmailProvider } from './email.provider';
import { InboxProvider } from './inbox.provider';
import { PushProvider } from './push.provider';
import { SmsProvider } from './sms.provider';
import { TelegramProvider } from './telegram.provider';
import { buildBody } from './template';
import {
  Notification,
  NotificationChannel,
  NotificationProvider,
  SendResult,
} from './notifications.types';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly providers = new Map<NotificationChannel, NotificationProvider>();
  private readonly idempotency = new IdempotencyCache();

  constructor(private readonly cfg: AppConfig) {}

  onModuleInit(): void {
    this.providers.set('email', new EmailProvider(this.cfg.smtp));
    this.providers.set('sms', new SmsProvider(this.cfg.smsProvider));
    this.providers.set('push', new PushProvider(this.cfg.webPush));
    this.providers.set('inbox', new InboxProvider());
    if (this.cfg.telegram) this.providers.set('telegram', new TelegramProvider(this.cfg.telegram));
    if (this.cfg.discord) this.providers.set('discord', new DiscordProvider(this.cfg.discord));
    logger.info(
      { channels: Array.from(this.providers.keys()) },
      'notification providers ready',
    );
  }

  availableChannels(): NotificationChannel[] {
    return Array.from(this.providers.keys());
  }

  /** Single send with idempotency. */
  async send(n: Notification): Promise<SendResult> {
    if (!n.id) n.id = uuid();
    const idemKey = `${n.channel}:${n.id}`;
    if (!this.idempotency.remember(idemKey)) {
      logger.debug({ id: n.id, channel: n.channel }, 'duplicate send skipped');
      return {
        id: n.id,
        channel: n.channel,
        status: 'skipped',
        error: 'duplicate',
      };
    }
    const provider = this.providers.get(n.channel);
    if (!provider) {
      return {
        id: n.id,
        channel: n.channel,
        status: 'skipped',
        error: `no provider for ${n.channel}`,
      };
    }
    const built = buildBody(n, n.data);
    const enriched: Notification = { ...n, subject: built.subject, body: built.body };
    return provider.send(enriched);
  }

  /** Fan-out: same content to multiple channels, all in parallel. */
  async fanout(n: Notification, channels: NotificationChannel[]): Promise<SendResult[]> {
    return Promise.all(
      channels.map((c) => this.send({ ...n, id: n.id ? `${n.id}:${c}` : uuid(), channel: c })),
    );
  }
}
