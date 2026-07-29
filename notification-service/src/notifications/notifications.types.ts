export type NotificationChannel = 'email' | 'sms' | 'push' | 'telegram' | 'discord' | 'inbox';

export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export interface Notification {
  /** Stable per-attempt id used for idempotency. */
  id: string;
  channel: NotificationChannel;
  /** Channel-specific target (email, phone, push sub, chat_id, …). */
  recipient: string;
  subject?: string;
  body: string;
  /** Optional structured data (template vars, locale, …). */
  data?: Record<string, unknown>;
  /** Optional tracing key, propagated to logs. */
  correlationId?: string;
}

export interface SendResult {
  id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  error?: string;
  sentAt?: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(n: Notification): Promise<SendResult>;
}
